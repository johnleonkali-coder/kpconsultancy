(function () {
  const cfg = window.KP_CONFIG;
  let adminSession = null;
  let adminProfile = null;
  let allPosts = [];
  let activeHashtags = [];

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function showAdminAlert(msg, isError) {
    const el = document.getElementById("adminAlert");
    el.textContent = msg;
    el.className = `alert show ${isError ? "alert-error" : "alert-success"}`;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function clearAdminAlert() {
    const el = document.getElementById("adminAlert");
    el.className = "alert";
  }

  function getTodayIsoDate() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function normalizeTag(raw) {
    const cleaned = String(raw || "")
      .trim()
      .replace(/^#+/, "")
      .replace(/[^a-zA-Z0-9_]/g, "");
    return cleaned ? `#${cleaned}` : "";
  }

  function renderHashtagChips() {
    const container = document.getElementById("hashtagChips");
    if (activeHashtags.length === 0) {
      container.innerHTML = "";
      return;
    }
    container.innerHTML = activeHashtags
      .map(
        (tag, idx) => `
        <span class="chip">
          ${escapeHtml(tag)}
          <button type="button" data-idx="${idx}" aria-label="Remove ${escapeHtml(tag)}">&times;</button>
        </span>
      `
      )
      .join("");

    container.querySelectorAll("button[data-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const index = Number(btn.dataset.idx);
        activeHashtags.splice(index, 1);
        renderHashtagChips();
      });
    });
  }

  function addHashtag(raw) {
    const tag = normalizeTag(raw);
    if (!tag) return;
    if (!activeHashtags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
      activeHashtags.push(tag);
      renderHashtagChips();
    }
  }

  function analyzeRawJobText(rawText) {
    const text = String(rawText || "").trim();
    if (!text) return;

    const extractedTags = [];
    const hashRegex = /(?:^|\s)(#[a-zA-Z0-9_]+)/g;
    let m;
    while ((m = hashRegex.exec(text)) !== null) {
      extractedTags.push(m[1]);
    }

    const urlRegex = /(https?:\/\/[^\s<>"')]+)/gi;
    const urls = text.match(urlRegex) || [];
    let detectedApplyUrl = "";
    if (urls.length > 0) {
      const priorityUrl = urls.find((u) =>
        /(apply|career|job|lever\.co|greenhouse\.io|workday|ashbyhq|smartrecruiters|linkedin\.com\/jobs|indeed)/i.test(u)
      );
      detectedApplyUrl = priorityUrl || urls[0];
    }

    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    let detectedTitle = "";
    let titleLineIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^#[a-zA-Z0-9_]+(\s+#[a-zA-Z0-9_]+)*$/.test(line)) continue;
      if (/^https?:\/\//i.test(line)) continue;

      const labelMatch = line.match(/^(?:job\s*title|role|position|opening|hiring\s*for)\s*[:\-–]\s*(.+)$/i);
      if (labelMatch) {
        detectedTitle = labelMatch[1].replace(/#[a-zA-Z0-9_]+/g, "").trim();
        titleLineIndex = i;
        break;
      }

      if (i === 0 && line.length <= 120) {
        detectedTitle = line.replace(/#[a-zA-Z0-9_]+/g, "").trim();
        titleLineIndex = i;
        break;
      }
    }

    let detectedCompany = "";
    for (let i = 0; i < Math.min(lines.length, 6); i++) {
      const compMatch = lines[i].match(/^(?:company|organization|client|employer)\s*[:\-–]\s*(.+)$/i);
      if (compMatch) {
        detectedCompany = compMatch[1].replace(/#[a-zA-Z0-9_]+/g, "").trim();
        break;
      }
    }

    const bodyLines = lines.filter((_, idx) => idx !== titleLineIndex);
    let cleanedBody = bodyLines
      .join("\n")
      .replace(/(?:^|\s)#[a-zA-Z0-9_]+/g, "")
      .replace(/^\s*(?:apply\s*(?:here|now|link)?\s*[:\-–]?\s*)?https?:\/\/[^\s<>"')]+/gim, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    if (detectedTitle) {
      document.getElementById("postTitle").value = detectedTitle;
    }
    if (detectedCompany && !document.getElementById("postCompany").value) {
      document.getElementById("postCompany").value = detectedCompany;
    }
    if (cleanedBody) {
      document.getElementById("postDescription").value = cleanedBody;
    }
    if (detectedApplyUrl) {
      document.getElementById("postApplyUrl").value = detectedApplyUrl;
    }

    extractedTags.forEach((t) => addHashtag(t));
  }

  async function uploadJobImageIfSelected() {
    const fileInput = document.getElementById("postImageInput");
    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      return document.getElementById("existingImageUrl").value || null;
    }

    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowed.includes(file.type)) {
      throw new Error("Invalid image format. Please upload JPG, PNG, WebP, or GIF.");
    }
    if (file.size > 5 * 1024 * 1024) {
      throw new Error("Image must be 5 MB or smaller.");
    }

    const sb = window.KPAuth.getSupabaseClient();
    const ext = file.name.split(".").pop().toLowerCase() || "jpg";
    const filePath = `${adminSession.user.id}/${Date.now()}_${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await sb.storage
      .from(cfg.STORAGE_BUCKET)
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: false
      });

    if (uploadError) {
      throw new Error("Image upload failed: " + uploadError.message);
    }

    const { data: publicData } = sb.storage
      .from(cfg.STORAGE_BUCKET)
      .getPublicUrl(filePath);

    return publicData.publicUrl;
  }

  function resetEditorForm() {
    document.getElementById("postForm").reset();
    document.getElementById("rawJobPaste").value = "";
    document.getElementById("editingPostId").value = "";
    document.getElementById("existingImageUrl").value = "";
    document.getElementById("postPublishedDate").value = getTodayIsoDate();
    document.getElementById("formHeading").textContent = "Create New Job Post";
    document.getElementById("publishBtn").textContent = "Publish Job Post";
    document.getElementById("cancelEditBtn").classList.add("hidden");
    document.getElementById("currentImageNote").classList.add("hidden");
    activeHashtags = [];
    renderHashtagChips();
  }

  function startEditPost(post) {
    clearAdminAlert();
    document.getElementById("editingPostId").value = post.id;
    document.getElementById("existingImageUrl").value = post.image_url || "";
    document.getElementById("postTitle").value = post.title || "";
    document.getElementById("postCompany").value = post.company_name || "";
    document.getElementById("postDescription").value = post.description || "";
    document.getElementById("postApplyUrl").value = post.apply_url || "";
    document.getElementById("postPublishedDate").value = post.published_date || getTodayIsoDate();
    document.getElementById("postImageInput").value = "";

    const imgNote = document.getElementById("currentImageNote");
    if (post.image_url) {
      imgNote.textContent = "Current image attached. Choose a new file only if you want to replace it.";
      imgNote.classList.remove("hidden");
    } else {
      imgNote.classList.add("hidden");
    }

    activeHashtags = (post.hashtags || []).map((t) => (t.startsWith("#") ? t : `#${t}`));
    renderHashtagChips();

    document.getElementById("formHeading").textContent = "Edit Job Post";
    document.getElementById("publishBtn").textContent = "Save Changes";
    document.getElementById("cancelEditBtn").classList.remove("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function savePost(e) {
    e.preventDefault();
(function () {
  const cfg = window.KP_CONFIG;
  let adminSession = null;
  let adminProfile = null;
  let allPosts = [];
  let activeHashtags = [];

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function showAdminAlert(msg, isError) {
    const el = document.getElementById("adminAlert");
    el.textContent = msg;
    el.className = `alert show ${isError ? "alert-error" : "alert-success"}`;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function clearAdminAlert() {
    const el = document.getElementById("adminAlert");
    el.className = "alert";
  }

  function getTodayIsoDate() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function normalizeTag(raw) {
    const cleaned = String(raw || "")
      .trim()
      .replace(/^#+/, "")
      .replace(/[^a-zA-Z0-9_]/g, "");
    return cleaned ? `#${cleaned}` : "";
  }

  function renderHashtagChips() {
    const container = document.getElementById("hashtagChips");
    if (activeHashtags.length === 0) {
      container.innerHTML = "";
      return;
    }
    container.innerHTML = activeHashtags
      .map(
        (tag, idx) => `
        <span class="chip">
          ${escapeHtml(tag)}
          <button type="button" data-idx="${idx}" aria-label="Remove ${escapeHtml(tag)}">&times;</button>
        </span>
      `
      )
      .join("");

    container.querySelectorAll("button[data-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const index = Number(btn.dataset.idx);
        activeHashtags.splice(index, 1);
        renderHashtagChips();
      });
    });
  }

  function addHashtag(raw) {
    const tag = normalizeTag(raw);
    if (!tag) return;
    if (!activeHashtags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
      activeHashtags.push(tag);
      renderHashtagChips();
    }
  }

  function analyzeRawJobText(rawText) {
    const text = String(rawText || "").trim();
    if (!text) return;

    const extractedTags = [];
    const hashRegex = /(?:^|\s)(#[a-zA-Z0-9_]+)/g;
    let m;
    while ((m = hashRegex.exec(text)) !== null) {
      extractedTags.push(m[1]);
    }

    const urlRegex = /(https?:\/\/[^\s<>"')]+)/gi;
    const urls = text.match(urlRegex) || [];
    let detectedApplyUrl = "";
    if (urls.length > 0) {
      const priorityUrl = urls.find((u) =>
        /(apply|career|job|lever\.co|greenhouse\.io|workday|ashbyhq|smartrecruiters|linkedin\.com\/jobs|indeed)/i.test(u)
      );
      detectedApplyUrl = priorityUrl || urls[0];
    }

    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    let detectedTitle = "";
    let titleLineIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^#[a-zA-Z0-9_]+(\s+#[a-zA-Z0-9_]+)*$/.test(line)) continue;
      if (/^https?:\/\//i.test(line)) continue;

      const labelMatch = line.match(/^(?:job\s*title|role|position|opening|hiring\s*for)\s*[:\-–]\s*(.+)$/i);
      if (labelMatch) {
        detectedTitle = labelMatch[1].replace(/#[a-zA-Z0-9_]+/g, "").trim();
        titleLineIndex = i;
        break;
      }

      if (i === 0 && line.length <= 120) {
        detectedTitle = line.replace(/#[a-zA-Z0-9_]+/g, "").trim();
        titleLineIndex = i;
        break;
      }
    }

    let detectedCompany = "";
    for (let i = 0; i < Math.min(lines.length, 6); i++) {
      const compMatch = lines[i].match(/^(?:company|organization|client|employer)\s*[:\-–]\s*(.+)$/i);
      if (compMatch) {
        detectedCompany = compMatch[1].replace(/#[a-zA-Z0-9_]+/g, "").trim();
        break;
      }
    }

    const bodyLines = lines.filter((_, idx) => idx !== titleLineIndex);
    let cleanedBody = bodyLines
      .join("\n")
      .replace(/(?:^|\s)#[a-zA-Z0-9_]+/g, "")
      .replace(/^\s*(?:apply\s*(?:here|now|link)?\s*[:\-–]?\s*)?https?:\/\/[^\s<>"')]+/gim, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    if (detectedTitle) {
      document.getElementById("postTitle").value = detectedTitle;
    }
    if (detectedCompany && !document.getElementById("postCompany").value) {
      document.getElementById("postCompany").value = detectedCompany;
    }
    if (cleanedBody) {
      document.getElementById("postDescription").value = cleanedBody;
    }
    if (detectedApplyUrl) {
      document.getElementById("postApplyUrl").value = detectedApplyUrl;
    }

    extractedTags.forEach((t) => addHashtag(t));
  }

  async function uploadJobImageIfSelected() {
    const fileInput = document.getElementById("postImageInput");
    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      return document.getElementById("existingImageUrl").value || null;
    }

    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowed.includes(file.type)) {
      throw new Error("Invalid image format. Please upload JPG, PNG, WebP, or GIF.");
    }
    if (file.size > 5 * 1024 * 1024) {
      throw new Error("Image must be 5 MB or smaller.");
    }

    const sb = window.KPAuth.getSupabaseClient();
    const ext = file.name.split(".").pop().toLowerCase() || "jpg";
    const filePath = `${adminSession.user.id}/${Date.now()}_${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await sb.storage
      .from(cfg.STORAGE_BUCKET)
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: false
      });

    if (uploadError) {
      throw new Error("Image upload failed: " + uploadError.message);
    }

    const { data: publicData } = sb.storage
      .from(cfg.STORAGE_BUCKET)
      .getPublicUrl(filePath);

    return publicData.publicUrl;
  }

  function resetEditorForm() {
    document.getElementById("postForm").reset();
    document.getElementById("rawJobPaste").value = "";
    document.getElementById("editingPostId").value = "";
    document.getElementById("existingImageUrl").value = "";
    document.getElementById("postPublishedDate").value = getTodayIsoDate();
    document.getElementById("formHeading").textContent = "Create New Job Post";
    document.getElementById("publishBtn").textContent = "Publish Job Post";
    document.getElementById("cancelEditBtn").classList.add("hidden");
    document.getElementById("currentImageNote").classList.add("hidden");
    activeHashtags = [];
    renderHashtagChips();
  }

  function startEditPost(post) {
    clearAdminAlert();
    document.getElementById("editingPostId").value = post.id;
    document.getElementById("existingImageUrl").value = post.image_url || "";
    document.getElementById("postTitle").value = post.title || "";
    document.getElementById("postCompany").value = post.company_name || "";
    document.getElementById("postDescription").value = post.description || "";
    document.getElementById("postApplyUrl").value = post.apply_url || "";
    document.getElementById("postPublishedDate").value = post.published_date || getTodayIsoDate();
    document.getElementById("postImageInput").value = "";

    const imgNote = document.getElementById("currentImageNote");
    if (post.image_url) {
      imgNote.textContent = "Current image attached. Choose a new file only if you want to replace it.";
      imgNote.classList.remove("hidden");
    } else {
      imgNote.classList.add("hidden");
    }

    activeHashtags = (post.hashtags || []).map((t) => (t.startsWith("#") ? t : `#${t}`));
    renderHashtagChips();

    document.getElementById("formHeading").textContent = "Edit Job Post";
    document.getElementById("publishBtn").textContent = "Save Changes";
    document.getElementById("cancelEditBtn").classList.remove("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function savePost(e) {
    e.preventDefault();
    clearAdminAlert();

    const publishBtn = document.getElementById("publishBtn");
    publishBtn.disabled = true;

    try {
      const editingId = document.getElementById("editingPostId").value.trim();
      const title = document.getElementById("postTitle").value.trim();
      const companyName = document.getElementById("postCompany").value.trim();
      const rawDesc = document.getElementById("postDescription").value;
      const applyUrl = document.getElementById("postApplyUrl").value.trim();
      const publishedDate = document.getElementById("postPublishedDate").value || getTodayIsoDate();

      if (!title || !rawDesc.trim()) {
        throw new Error("Job Title and Job Description are required.");
      }

      if (applyUrl && !window.KPPosts.isSafeHttpUrl(applyUrl)) {
        throw new Error("Application URL must start with http:// or https://");
      }

      const inlineHashRegex = /(?:^|\s)(#[a-zA-Z0-9_]+)/g;
      let match;
      while ((match = inlineHashRegex.exec(rawDesc)) !== null) {
        addHashtag(match[1]);
      }

      const cleanDescription = window.KPPosts.stripHashtagsFromText(rawDesc);
      const imageUrl = await uploadJobImageIfSelected();
      const sb = window.KPAuth.getSupabaseClient();

      let postId = editingId;

      if (editingId) {
        const { error: updateErr } = await sb
          .from("posts")
          .update({
            title,
            company_name: companyName || null,
            description: cleanDescription,
            apply_url: applyUrl || null,
            image_url: imageUrl,
            published_date: publishedDate,
            updated_at: new Date().toISOString()
          })
          .eq("id", editingId);

        if (updateErr) throw updateErr;

        await sb.from("post_hashtags").delete().eq("post_id", editingId);
      } else {
        const { data: inserted, error: insertErr } = await sb
          .from("posts")
          .insert([
            {
              admin_id: adminSession.user.id,
              title,
              company_name: companyName || null,
              description: cleanDescription,
              apply_url: applyUrl || null,
              image_url: imageUrl,
              published_date: publishedDate
            }
          ])
          .select("id")
          .single();

        if (insertErr) throw insertErr;
        postId = inserted.id;
      }

      if (activeHashtags.length > 0) {
        const tagRows = activeHashtags.map((tag) => ({
          post_id: postId,
          tag: tag.toLowerCase()
        }));
        const { error: tagErr } = await sb.from("post_hashtags").insert(tagRows);
        if (tagErr) throw tagErr;
      }

      resetEditorForm();
      await loadAdminPosts();
      showAdminAlert(
        editingId ? "Job post updated successfully." : "Job post published to the public feed!",
        false
      );
    } catch (err) {
      showAdminAlert(err.message || "Error saving job post.", true);
    } finally {
      publishBtn.disabled = false;
    }
  }

  async function deletePost(postId, title) {
    if (!confirm(`Delete "${title}" permanently? This will also remove its likes and comments.`)) {
      return;
    }
    clearAdminAlert();
    try {
      const sb = window.KPAuth.getSupabaseClient();
      const { error } = await sb.from("posts").delete().eq("id", postId);
      if (error) throw error;
      await loadAdminPosts();
      showAdminAlert("Job post deleted.", false);
    } catch (err) {
      showAdminAlert("Failed to delete post: " + err.message, true);
    }
  }

  async function openCommentsModeration(post) {
    const modal = document.getElementById("commentsModal");
    const titleEl = document.getElementById("commentsModalTitle");
    const bodyEl = document.getElementById("commentsModalBody");

    titleEl.textContent = `Comments on: ${post.title}`;
    bodyEl.innerHTML = `<div style="color:var(--text-muted);font-size:14px;">Loading comments...</div>`;
    modal.classList.add("open");

    const comments = await window.KPComments.fetchCommentsForPost(post.id);
    if (comments.length === 0) {
      bodyEl.innerHTML = `<div style="color:var(--text-secondary);font-size:14px;">No visitor comments on this post yet.</div>`;
      return;
    }

    bodyEl.innerHTML = comments
      .map(
        (c) => `
        <div class="comment-item" style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
          <div>
            <div style="font-weight:700;font-size:13px;color:var(--purple-900);">
              ${escapeHtml(c.visitor_name || "Candidate")}
              <span style="font-weight:400;color:var(--text-muted);margin-left:6px;">
                ${new Date(c.created_at).toLocaleDateString()}
              </span>
            </div>
            <div style="font-size:13.5px;margin-top:4px;">${escapeHtml(c.content)}</div>
          </div>
          <button type="button" class="btn btn-danger btn-sm btn-del-comment" data-comment-id="${escapeHtml(c.id)}">
            Delete
          </button>
        </div>
      `
      )
      .join("");

    bodyEl.querySelectorAll(".btn-del-comment").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const cid = btn.dataset.commentId;
        btn.disabled = true;
        const sb = window.KPAuth.getSupabaseClient();
        const { error } = await sb.from("post_comments").delete().eq("id", cid);
        if (!error) {
          btn.closest(".comment-item").remove();
          await loadAdminPosts();
        } else {
          alert("Could not delete comment: " + error.message);
          btn.disabled = false;
        }
      });
    });
  }

  function openPreviewModal() {
    const title = document.getElementById("postTitle").value.trim() || "Untitled Job Opening";
    const company = document.getElementById("postCompany").value.trim();
    const desc = window.KPPosts.stripHashtagsFromText(document.getElementById("postDescription").value);
    const applyUrl = document.getElementById("postApplyUrl").value.trim();
    const pubDate = document.getElementById("postPublishedDate").value || getTodayIsoDate();
    const fileInput = document.getElementById("postImageInput");
    const existingImg = document.getElementById("existingImageUrl").value;

    let previewImgSrc = existingImg;
    if (fileInput.files && fileInput.files[0]) {
      previewImgSrc = URL.createObjectURL(fileInput.files[0]);
    }

    const bodyEl = document.getElementById("previewModalBody");
    bodyEl.innerHTML = `
      <article class="post-card" style="margin-bottom:0;">
        <div class="post-header">
          <div class="post-author-row">
            <div class="post-avatar">KP</div>
            <div>
              <div class="post-author-name">KP Consultantsy</div>
              <div class="post-meta">
                <span>Published ${escapeHtml(window.KPPosts.formatDisplayDate(pubDate))}</span>
                ${company ? `<span>•</span><span class="post-company-tag">${escapeHtml(company)}</span>` : ""}
              </div>
            </div>
          </div>
        </div>
        <div class="post-body">
          <h2 class="post-title">${escapeHtml(title)}</h2>
          <div class="post-description">${escapeHtml(desc || "No description entered yet.")}</div>
          ${previewImgSrc ? `<div class="post-image-wrap"><img class="post-image" src="${escapeHtml(previewImgSrc)}" alt="Preview" /></div>` : ""}
          ${window.KPPosts.isSafeHttpUrl(applyUrl) ? `
            <div class="post-apply-bar">
              <span style="font-size:13px;color:var(--text-secondary);">Interested in this opportunity?</span>
              <span class="apply-btn">Apply Now ↗</span>
            </div>
          ` : ""}
        </div>
      </article>
      <div style="margin-top:12px;font-size:12.5px;color:var(--text-muted);">
        Hidden search hashtags attached (${activeHashtags.length}): ${escapeHtml(activeHashtags.join(", ") || "None")}
      </div>
    `;

    document.getElementById("previewModal").classList.add("open");
  }

  async function loadAdminPosts() {
    const listEl = document.getElementById("adminPostsList");
    try {
      allPosts = await window.KPPosts.fetchAllPublishedPosts();
      if (allPosts.length === 0) {
        listEl.innerHTML = `<div style="color:var(--text-secondary);font-size:14px;">No job posts published yet. Create your first posting on the left!</div>`;
        return;
      }

      listEl.innerHTML = allPosts
        .map(
          (p) => `
          <div class="admin-post-item">
            <div class="admin-post-header">
              <div>
                <div style="font-weight:700;font-size:15px;color:var(--purple-900);">${escapeHtml(p.title)}</div>
                <div style="font-size:12.5px;color:var(--text-muted);margin-top:2px;">
                  📅 ${escapeHtml(window.KPPosts.formatDisplayDate(p.published_date))}
                  ${p.company_name ? ` • <strong>${escapeHtml(p.company_name)}</strong>` : ""}
                </div>
              </div>
              <div style="font-size:12.5px;color:var(--text-secondary);white-space:nowrap;">
                💜 ${p.likeCount} &nbsp; 💬 ${p.commentCount}
              </div>
            </div>

            ${p.hashtags && p.hashtags.length ? `
              <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px;">
                ${p.hashtags.map((t) => `<span class="chip" style="font-size:11px;padding:2px 8px;">${escapeHtml(t)}</span>`).join("")}
              </div>
            ` : ""}

            <div class="admin-post-actions">
              <button type="button" class="btn btn-secondary btn-sm btn-edit-post" data-id="${escapeHtml(p.id)}">Edit</button>
              <button type="button" class="btn btn-outline btn-sm btn-mod-comments" data-id="${escapeHtml(p.id)}">
                Comments (${p.commentCount})
              </button>
              <button type="button" class="btn btn-danger btn-sm btn-del-post" data-id="${escapeHtml(p.id)}">Delete</button>
            </div>
          </div>
        `
        )
        .join("");

      listEl.querySelectorAll(".btn-edit-post").forEach((btn) => {
        btn.addEventListener("click", () => {
          const post = allPosts.find((x) => x.id === btn.dataset.id);
          if (post) startEditPost(post);
        });
      });

      listEl.querySelectorAll(".btn-mod-comments").forEach((btn) => {
        btn.addEventListener("click", () => {
          const post = allPosts.find((x) => x.id === btn.dataset.id);
          if (post) openCommentsModeration(post);
        });
      });

      listEl.querySelectorAll(".btn-del-post").forEach((btn) => {
        btn.addEventListener("click", () => {
          const post = allPosts.find((x) => x.id === btn.dataset.id);
          if (post) deletePost(post.id, post.title);
        });
      });
    } catch (err) {
      listEl.innerHTML = `<div class="alert alert-error show">Error loading posts: ${escapeHtml(err.message)}</div>`;
    }
  }

  async function initAdminDashboard() {
    const authData = await window.KPAuth.requireAdminSession();
    if (!authData) return;

    adminSession = authData.session;
    adminProfile = authData.profile;

    document.getElementById("adminUsernameBadge").textContent = `@${adminProfile.username}`;
    document.getElementById("postPublishedDate").value = getTodayIsoDate();

    document.getElementById("logoutBtn").addEventListener("click", () => {
      window.KPAuth.logoutAdmin();
    });

    document.getElementById("analyzeBtn").addEventListener("click", () => {
      const raw = document.getElementById("rawJobPaste").value;
      analyzeRawJobText(raw);
    });

    document.getElementById("addHashtagBtn").addEventListener("click", () => {
      const input = document.getElementById("hashtagInput");
      addHashtag(input.value);
      input.value = "";
    });

    document.getElementById("hashtagInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addHashtag(e.target.value);
        e.target.value = "";
      }
    });

    document.getElementById("cancelEditBtn").addEventListener("click", resetEditorForm);
    document.getElementById("postForm").addEventListener("submit", savePost);
    document.getElementById("previewBtn").addEventListener("click", openPreviewModal);

    document.getElementById("closePreviewBtn").addEventListener("click", () => {
      document.getElementById("previewModal").classList.remove("open");
    });

    document.getElementById("closeCommentsModalBtn").addEventListener("click", () => {
      document.getElementById("commentsModal").classList.remove("open");
    });

    await loadAdminPosts();
  }

  document.addEventListener("DOMContentLoaded", initAdminDashboard);
})();
￼Enter    clearAdminAlert();

    const publishBtn = document.getElementById("publishBtn");
    publishBtn.disabled = true;

    try {
      const editingId = document.getElementById("editingPostId").value.trim();
      const title = document.getElementById("postTitle").value.trim();
      const companyName = document.getElementById("postCompany").value.trim();
      const rawDesc = document.getElementById("postDescription").value;
      const applyUrl = document.getElementById("postApplyUrl").value.trim();
      const publishedDate = document.getElementById("postPublishedDate").value || getTodayIsoDate();

      if (!title || !rawDesc.trim()) {
        throw new Error("Job Title and Job Description are required.");
      }

      if (applyUrl && !window.KPPosts.isSafeHttpUrl(applyUrl)) {
        throw new Error("Application URL must start with http:// or https://");
      }

      const inlineHashRegex = /(?:^|\s)(#[a-zA-Z0-9_]+)/g;
      let match;
      while ((match = inlineHashRegex.exec(rawDesc)) !== null) {
        addHashtag(match[1]);
      }

      const cleanDescription = window.KPPosts.stripHashtagsFromText(rawDesc);
      const imageUrl = await uploadJobImageIfSelected();
      const sb = window.KPAuth.getSupabaseClient();

      let postId = editingId;

      if (editingId) {
        const { error: updateErr } = await sb
          .from("posts")
          .update({
            title,
            company_name: companyName || null,
            description: cleanDescription,
            apply_url: applyUrl || null,
            image_url: imageUrl,
            published_date: publishedDate,
            updated_at: new Date().toISOString()
          })
          .eq("id", editingId);

        if (updateErr) throw updateErr;

        await sb.from("post_hashtags").delete().eq("post_id", editingId);
      } else {
        const { data: inserted, error: insertErr } = await sb
          .from("posts")
          .insert([
            {
              admin_id: adminSession.user.id,
              title,
              company_name: companyName || null,
              description: cleanDescription,
              apply_url: applyUrl || null,
              image_url: imageUrl,
              published_date: publishedDate
            }
          ])
          .select("id")
          .single();

        if (insertErr) throw insertErr;
        postId = inserted.id;
      }

      if (activeHashtags.length > 0) {
        const tagRows = activeHashtags.map((tag) => ({
          post_id: postId,
          tag: tag.toLowerCase()
        }));
        const { error: tagErr } = await sb.from("post_hashtags").insert(tagRows);
        if (tagErr) throw tagErr;
      }

      resetEditorForm();
      await loadAdminPosts();
      showAdminAlert(
        editingId ? "Job post updated successfully." : "Job post published to the public feed!",
        false
      );
    } catch (err) {
      showAdminAlert(err.message || "Error saving job post.", true);
    } finally {
      publishBtn.disabled = false;
    }
  }

  async function deletePost(postId, title) {
    if (!confirm(`Delete "${title}" permanently? This will also remove its likes and comments.`)) {
      return;
    }
    clearAdminAlert();
    try {
      const sb = window.KPAuth.getSupabaseClient();
      const { error } = await sb.from("posts").delete().eq("id", postId);
      if (error) throw error;
      await loadAdminPosts();
      showAdminAlert("Job post deleted.", false);
    } catch (err) {
      showAdminAlert("Failed to delete post: " + err.message, true);
    }
  }

  async function openCommentsModeration(post) {
nst modal = document.getElementById("commentsModal");
    const titleEl = document.getElementById("commentsModalTitle");
    const bodyEl = document.getElementById("commentsModalBody");

    titleEl.textContent = `Comments on: ${post.title}`;
    bodyEl.innerHTML = `<div style="color:var(--text-muted);font-size:14px;">Loading comments...</div>`;
    modal.classList.add("open");

    const comments = await window.KPComments.fetchCommentsForPost(post.id);
    if (comments.length === 0) {
      bodyEl.innerHTML = `<div style="color:var(--text-secondary);font-size:14px;">No visitor comments on this post yet.</div>`;
      return;
    }

    bodyEl.innerHTML = comments
      .map(
        (c) => `
        <div class="comment-item" style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
          <div>
            <div style="font-weight:700;font-size:13px;color:var(--purple-900);">
              ${escapeHtml(c.visitor_name || "Candidate")}
              <span style="font-weight:400;color:var(--text-muted);margin-left:6px;">
                ${new Date(c.created_at).toLocaleDateString()}
              </span>
            </div>
            <div style="font-size:13.5px;margin-top:4px;">${escapeHtml(c.content)}</div>
          </div>
          <button type="button" class="btn btn-danger btn-sm btn-del-comment" data-comment-id="${escapeHtml(c.id)}">
            Delete
          </button>
        </div>
      `
      )
      .join("");

    bodyEl.querySelectorAll(".btn-del-comment").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const cid = btn.dataset.commentId;
        btn.disabled = true;
        const sb = window.KPAuth.getSupabaseClient();
        const { error } = await sb.from("post_comments").delete().eq("id", cid);
        if (!error) {
          btn.closest(".comment-item").remove();
          await loadAdminPosts();
        } else {
          alert("Could not delete comment: " + error.message);
          btn.disabled = false;
        }
      });
    });
  }

  function openPreviewModal() {
    const title = document.getElementById("postTitle").value.trim() || "Untitled Job Opening";
    const company = document.getElementById("postCompany").value.trim();
    const desc = window.KPPosts.stripHashtagsFromText(document.getElementById("postDescription").value);
    const applyUrl = document.getElementById("postApplyUrl").value.trim();
    const pubDate = document.getElementById("postPublishedDate").value || getTodayIsoDate();
    const fileInput = document.getElementById("postImageInput");
    const existingImg = document.getElementById("existingImageUrl").value;

    let previewImgSrc = existingImg;
    if (fileInput.files && fileInput.files[0]) {
      previewImgSrc = URL.createObjectURL(fileInput.files[0]);
    }

    const bodyEl = document.getElementById("previewModalBody");
    bodyEl.innerHTML = `
      <article class="post-card" style="margin-bottom:0;">
        <div class="post-header">
          <div class="post-author-row">
            <div class="post-avatar">KP</div>
            <div>
              <div class="post-author-name">KP Consultantsy</div>
              <div class="post-meta">
                <span>Published ${escapeHtml(window.KPPosts.formatDisplayDate(pubDate))}</span>
                ${company ? `<span>•</span><span class="post-company-tag">${escapeHtml(company)}</span>` : ""}
              </div>
            </div>
          </div>
        </div>
        <div class="post-body">
          <h2 class="post-title">${escapeHtml(title)}</h2>
          <div class="post-description">${escapeHtml(desc || "No description entered yet.")}</div>
          ${previewImgSrc ? `<div class="post-image-wrap"><img class="post-image" src="${escapeHtml(previewImgSrc)}" alt="Preview" /></div>` : ""}
          ${window.KPPosts.isSafeHttpUrl(applyUrl) ? `
            <div class="post-apply-bar">
              <span style="font-size:13px;color:var(--text-secondary);">Interested in this opportunity?</span>
              <span class="apply-btn">Apply Now ↗</span>
            </div>
          ` : ""}
        </div>
      </article>
      <div style="margin-top:12px;font-size:12.5px;color:var(--text-muted);">
        Hidden search hashtags attached (${activeHashtags.length}): ${escapeHtml(activeHashtags.join(", ") || "None")}
      </div>
    `;

    document.getElementById("previewModal").classList.add("open");
  }

  async function loadAdminPosts() {
    const listEl = document.getElementById("adminPostsList");
    try {
      allPosts = await window.KPPosts.fetchAllPublishedPosts();
      if (allPosts.length === 0) {
        listEl.innerHTML = `<div style="color:var(--text-secondary);font-size:14px;">No job posts published yet. Create your first posting on the left!</div>`;
        return;
      }

