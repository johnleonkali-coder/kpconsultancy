function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

function normalizePhone(phone) {
  return String(phone || "").replace(/[^\d+]/g, "").trim();
}

function generateSixDigitOtp() {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(100000 + (arr[0] % 900000));
}

async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function sendSmsOtp({ accountSid, authToken, fromNumber, toNumber, otp }) {
  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
  const body = new URLSearchParams({
    From: fromNumber,
    To: toNumber,
    Body: `KP Consultantsy Admin Password Reset OTP: ${otp}. Valid for 10 minutes.`
  });

  const basicAuth = btoa(`${accountSid}:${authToken}`);
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`SMS provider error (${resp.status}): ${errText}`);
  }
}

async function lookupAdminByUsernameAndMobile(supabaseUrl, serviceRoleKey, username, mobile) {
  const url = `${supabaseUrl}/rest/v1/admin_profiles?username=eq.${encodeURIComponent(username)}&is_active=eq.true&select=id,username,mobile_number,is_active`;
  const resp = await fetch(url, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`
    }
  });

  if (!resp.ok) {
    throw new Error("Failed to query admin profile.");
  }

  const rows = await resp.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  const admin = rows[0];
  const storedPhone = normalizePhone(admin.mobile_number);
  const providedPhone = normalizePhone(mobile);

  if (!storedPhone || storedPhone !== providedPhone) {
    return null;
  }

  return admin;
}

async function updateSupabaseUserPassword(supabaseUrl, serviceRoleKey, userId, newPassword) {
  const resp = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "PUT",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ password: newPassword })
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Password update failed: ${errText}`);
  }
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const supabaseUrl = env.SUPABASE_URL;
    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
    const otpSecret = env.OTP_SIGNING_SECRET || serviceRoleKey;

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Server OTP recovery environment is not configured." }, 500);
    }

    const body = await request.json();
    const action = String(body.action || "");
    const username = String(body.username || "").trim().toLowerCase();
    const mobileNumber = normalizePhone(body.mobile_number);

    if (!username || !mobileNumber) {
      return jsonResponse({ error: "Username and registered mobile number are required." }, 400);
    }

    const admin = await lookupAdminByUsernameAndMobile(supabaseUrl, serviceRoleKey, username, mobileNumber);
    if (!admin) {
      return jsonResponse({ error: "No active admin account matches that username and mobile number." }, 404);
    }

    if (action === "send_otp") {
      const otp = generateSixDigitOtp();
      const expiresAt = Date.now() + 10 * 60 * 1000;
      const payloadStr = `${admin.id}:${mobileNumber}:${otp}:${expiresAt}`;
      const signature = await hmacSha256Hex(otpSecret, payloadStr);

      if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER) {
        await sendSmsOtp({
          accountSid: env.TWILIO_ACCOUNT_SID,
          authToken: env.TWILIO_AUTH_TOKEN,
          fromNumber: env.TWILIO_FROM_NUMBER,
          toNumber: mobileNumber,
          otp
        });
        return jsonResponse({
          ok: true,
          message: "6-digit OTP sent to your registered mobile number. Valid for 10 minutes."
        });
      }

      return jsonResponse({
        ok: true,
        message: "Recovery code generated (SMS gateway not configured; use verification token below).",
        dev_challenge: `${expiresAt}.${signature}`
      });
    }

    if (action === "verify_and_reset") {
      const otp = String(body.otp || "").trim();
      const newPassword = String(body.new_password || "");
      const challenge = String(body.challenge || "");

      if (newPassword.length < 8) {
        return jsonResponse({ error: "New password must be at least 8 characters long." }, 400);
      }

      if (challenge.includes(".")) {
        const [expStr, sig] = challenge.split(".");
        const expNum = Number(expStr);
        if (!expNum || Date.now() > expNum) {
          return jsonResponse({ error: "OTP has expired. Please request a new one." }, 400);
        }
        const expectedSig = await hmacSha256Hex(otpSecret, `${admin.id}:${mobileNumber}:${otp}:${expNum}`);
        if (!timingSafeEqual(sig, expectedSig)) {
          return jsonResponse({ error: "Invalid 6-digit OTP." }, 400);
        }
      } else if (!/^\d{6}$/.test(otp)) {
        return jsonResponse({ error: "Please enter a valid 6-digit OTP." }, 400);
      }

      await updateSupabaseUserPassword(supabaseUrl, serviceRoleKey, admin.id, newPassword);
      return jsonResponse({ ok: true, message: "Admin password updated successfully." });
    }

    return jsonResponse({ error: "Unsupported action." }, 400);
  } catch (err) {
    return jsonResponse({ error: err.message || "Unexpected server error." }, 500);
  }
}
￼Enteron jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

function normalizePhone(phone) {
  return String(phone || "").replace(/[^\d+]/g, "").trim();
}

function generateSixDigitOtp() {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(100000 + (arr[0] % 900000));
}

async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function sendSmsOtp({ accountSid, authToken, fromNumber, toNumber, otp }) {
  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
  const body = new URLSearchParams({
    From: fromNumber,
    To: toNumber,
    Body: `KP Consultantsy Admin Password Reset OTP: ${otp}. Valid for 10 minutes.`
  });

  const basicAuth = btoa(`${accountSid}:${authToken}`);
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`SMS provider error (${resp.status}): ${errText}`);
  }
}

async function lookupAdminByUsernameAndMobile(supabaseUrl, serviceRoleKey, username, mobile) {
  const url = `${supabaseUrl}/rest/v1/admin_profiles?username=eq.${encodeURIComponent(username)}&is_active=eq.true&select=id,username,mobile_number,is_active`;
  const resp = await fetch(url, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`
    }
  });

  if (!resp.ok) {
    throw new Error("Failed to query admin profile.");
  }

  const rows = await resp.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  const admin = rows[0];
  const storedPhone = normalizePhone(admin.mobile_number);
