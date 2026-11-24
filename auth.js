(function () {
  const cfg = window.KP_CONFIG;

  function getSupabaseClient() {
    if (!window.supabase) {
      throw new Error("Supabase SDK failed to load.");
    }
    if (!window._kpSupabase) {
      window._kpSupabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false
        }
      });
    }
    return window._kpSupabase;
  }

  function usernameToSyntheticEmail(username) {
    const clean = String(username || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, "");
    if (!clean) return "";
    return `${clean}@${cfg.ADMIN_AUTH_DOMAIN}`;
  }

  async function loginWithUsername(username, password) {
    const sb = getSupabaseClient();
    const cleanUser = String(username || "").trim().toLowerCase();
    if (!cleanUser || !password) {
      throw new Error("Please enter both username and password.");
    }

    const syntheticEmail = usernameToSyntheticEmail(cleanUser);
    const { data, error } = await sb.auth.signInWithPassword({
      email: syntheticEmail,
      password: password
    });

    if (error) {
      throw new Error("Invalid username or password.");
    }

    const { data: profile, error: profileError } = await sb
      .from("admin_profiles")
      .select("id, username, mobile_number, is_active")
      .eq("id", data.user.id)
      .single();

    if (profileError || !profile || !profile.is_active) {
      await sb.auth.signOut();
      throw new Error("Unauthorized: This account does not have active admin privileges.");
    }

    return { session: data.session, profile };
  }

  async function requestMobileOtp(username, mobileNumber) {
    const res = await fetch(`${cfg.API_BASE}/admin-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "send_otp",
        username: String(username || "").trim().toLowerCase(),
        mobile_number: String(mobileNumber || "").trim()
      })
    });
    const payload = await res.json();
    if (!res.ok) {
      throw new Error(payload.error || "Unable to send recovery OTP.");
    }
    return payload;
  }

  async function resetPasswordWithOtp(username, mobileNumber, otpCode, newPassword) {
    const res = await fetch(`${cfg.API_BASE}/admin-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "verify_and_reset",
        username: String(username || "").trim().toLowerCase(),
        mobile_number: String(mobileNumber || "").trim(),
        otp: String(otpCode || "").trim(),
        new_password: newPassword
      })
    });
    const payload = await res.json();
    if (!res.ok) {
      throw new Error(payload.error || "OTP verification failed.");
    }
    return payload;
  }

  async function requireAdminSession() {
    const sb = getSupabaseClient();
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      window.location.replace("login.html");
      return null;
    }

    const { data: profile, error } = await sb
      .from("admin_profiles")
      .select("id, username, mobile_number, is_active")
      .eq("id", session.user.id)
      .single();

    if (error || !profile || !profile.is_active) {
      await sb.auth.signOut();
      window.location.replace("login.html");
      return null;
    }

    return { session, profile };
  }

  async function logoutAdmin() {
    const sb = getSupabaseClient();
    await sb.auth.signOut();
    window.location.href = "login.html";
  }

  window.KPAuth = {
    getSupabaseClient,
    loginWithUsername,
    requestMobileOtp,
    resetPasswordWithOtp,
    requireAdminSession,
    logoutAdmin
  };
})();
￼Enter
