const config = window.NORTHSTAR_SUPABASE_CONFIG;
const supabaseClient = window.supabase.createClient(config.url, config.publishableKey);
let currentUser = null;
let currentProfile = null;
let allJobsCache = [];
let pendingJobId = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" })[c]);
}

function showMessage(el, msg, isError = false) {
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle("is-error", isError);
}

async function refreshCurrentUser() {
  const { data, error } = await supabaseClient.auth.getUser();
  currentUser = error ? null : data?.user;
  
  if (currentUser) {
    const { data: profile } = await supabaseClient.from("profiles").select("*").eq("id", currentUser.id).maybeSingle();
    currentProfile = profile;
  } else {
    currentProfile = null;
  }
  
  updateNavState();
  return currentUser;
}

function updateNavState() {
  document.querySelectorAll("[data-open-auth]").forEach((btn) => {
    btn.textContent = currentUser ? "Sign out" : "Sign in";
    btn.classList.toggle("is-signed-in", Boolean(currentUser));
  });
  document.querySelectorAll(".nav-profile-link").forEach((el) => {
    el.hidden = !Boolean(currentUser);
  });
}

function openAuthDialog(heading = "Sign in to your account") {
  const dialog = document.querySelector("[data-auth-dialog]");
  if (!dialog) return;
  dialog.querySelector("[data-auth-heading]").textContent = heading;
  showMessage(dialog.querySelector(".form-message"), "");
  dialog.showModal();
}

function setupAuthModal() {
  const form = document.querySelector("[data-auth-form]");
  if (!form) return;
  let isSignUp = false;
  const heading = form.querySelector("[data-auth-heading]");
  const submit = form.querySelector("[data-auth-submit]");
  const toggle = form.querySelector("[data-auth-toggle]");
  const message = form.querySelector(".form-message");

  const setMode = () => {
    heading.textContent = isSignUp ? "Create your account" : "Sign in to your account";
    submit.innerHTML = `${isSignUp ? "Create account" : "Sign in"} <span>→</span>`;
    toggle.textContent = isSignUp ? "Already have an account? Sign in" : "New here? Create an account";
    showMessage(message, "");
  };

  toggle.addEventListener("click", () => { isSignUp = !isSignUp; setMode(); });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;
    submit.disabled = true;
    showMessage(message, "Processing...");

    const res = isSignUp
      ? await supabaseClient.auth.signUp({ email, password })
      : await supabaseClient.auth.signInWithPassword({ email, password });

    submit.disabled = false;
    if (res.error) {
      showMessage(message, res.error.message, true);
      return;
    }

    await refreshCurrentUser();
    form.reset();
    form.closest("dialog").close();
    if (pendingJobId) openApplicationModal(pendingJobId);
    if (window.location.pathname.includes("profile.html")) loadProfilePage();
  });
}

function setupApplicationModal() {
  const form = document.querySelector("[data-apply-form]");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = form.querySelector(".form-message");
    const user = await refreshCurrentUser();
    if (!user) {
      form.closest("dialog").close();
      openAuthDialog("Sign in to submit your application");
      return;
    }

    if (currentProfile?.is_blocked) {
      showMessage(msg, "This account is suspended. Applications are disabled.", true);
      return;
    }

    const file = form.elements.resume.files[0];
    if (!file) { showMessage(msg, "Please choose a résumé file.", true); return; }
    if (file.size > 5 * 1024 * 1024) { showMessage(msg, "CV file must be 5 MB or smaller.", true); return; }

    const ext = file.name.split(".").pop().toLowerCase();
    const submitBtn = form.querySelector('[type="submit"]');
    submitBtn.disabled = true;
    showMessage(msg, "Uploading CV securely...");

    const path = `${user.id}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabaseClient.storage.from("resumes").upload(path, file, { upsert: true });
    if (upErr) {
      submitBtn.disabled = false;
      showMessage(msg, upErr.message, true);
      return;
    }

    // Save profile contact details & apply
    await supabaseClient.from("profiles").update({
      full_name: form.elements.name.value.trim(),
      phone: form.elements.phone.value.trim(),
      resume_path: path
    }).eq("id", user.id);

    const { error: appErr } = await supabaseClient.from("applications").insert({
      job_id: form.elements.jobId.value,
      candidate_id: user.id,
      full_name: form.elements.name.value.trim(),
      email: user.email,
      phone: form.elements.phone.value.trim(),
      message: form.elements.message.value.trim() || null,
      resume_path: path,
      status: "received"
    });

    submitBtn.disabled = false;
    if (appErr) {
      showMessage(msg, appErr.code === "23505" ? "You have already applied for this role." : appErr.message, true);
      return;
    }

    showMessage(msg, "Application submitted successfully!");
    setTimeout(() => { form.reset(); form.closest("dialog").close(); }, 1500);
  });
}

function openApplicationModal(jobId) {
  const job = allJobsCache.find((j) => String(j.id) === String(jobId));
  if (!job) return;
  pendingJobId = job.id;
  if (!currentUser) {
    openAuthDialog("Sign in to apply");
    return;
  }

  const dialog = document.querySelector("[data-apply-dialog]");
  dialog.querySelector("[data-application-title]").textContent = `Apply for ${job.title}`;
  dialog.querySelector('[name="jobId"]').value = job.id;
  dialog.querySelector('[name="email"]').value = currentUser.email || "";
  if (currentProfile) {
    dialog.querySelector('[name="name"]').value = currentProfile.full_name || "";
    dialog.querySelector('[name="phone"]').value = currentProfile.phone || "";
  }
  showMessage(dialog.querySelector(".form-message"), "");
  dialog.showModal();
}

async function toggleSaveJob(jobId, btn) {
  if (!currentUser) {
    openAuthDialog("Sign in to save jobs");
    return;
  }
  const { data: existing } = await supabaseClient.from("saved_jobs").select("id").eq("candidate_id", currentUser.id).eq("job_id", jobId).maybeSingle();
  if (existing) {
    await supabaseClient.from("saved_jobs").delete().eq("id", existing.id);
    btn.textContent = "♡";
  } else {
    await supabaseClient.from("saved_jobs").insert({ candidate_id: currentUser.id, job_id: jobId });
    btn.textContent = "♥";
  }
}

// ----------------------------------------------------
// PAGE-SPECIFIC INITIALIZATIONS
// ----------------------------------------------------

// 1. Homepage (index.html)
async function initHomePage() {
  const container = document.querySelector("[data-featured-jobs]");
  if (!container) return;

  const { data: jobs } = await supabaseClient
    .from("jobs")
    .select("*")
    .eq("is_open", true)
    .order("is_featured", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(4);

  allJobsCache = jobs || [];

  if (!jobs || jobs.length === 0) {
    container.innerHTML = "<p class='empty-state'>No featured roles available right now.</p>";
    return;
  }

  container.innerHTML = jobs.map((j) => `
    <article class="job-card">
      <div>
        <h3 class="job-title">${escapeHtml(j.title)} ${j.is_featured ? '<span class="featured-badge">Featured</span>' : ''}</h3>
        <p class="job-meta">${escapeHtml(j.department)} · ${escapeHtml(j.employment_type)}</p>
      </div>
      <p class="job-detail">${escapeHtml(j.location)}</p>
      <button class="job-save-btn" data-save="${j.id}" title="Save job">♡</button>
      <button class="job-arrow" aria-label="Apply" data-apply="${j.id}">→</button>
    </article>
  `).join("");

  bindJobEvents(container);
}

// 2. All Jobs Page (jobs.html)
async function initJobsPage() {
  const container = document.querySelector("[data-all-jobs]");
  const noMsg = document.querySelector("[data-no-jobs-msg]");
  if (!container) return;

  const { data: jobs } = await supabaseClient.from("jobs").select("*").eq("is_open", true).order("created_at", { ascending: false });
  allJobsCache = jobs || [];

  // Populate dynamic filter dropdowns
  const deptSelect = document.querySelector("[data-filter-department]");
  const locSelect = document.querySelector("[data-filter-location]");
  const typeSelect = document.querySelector("[data-filter-type]");
  const searchInput = document.querySelector("[data-filter-search]");

  const depts = [...new Set(allJobsCache.map((j) => j.department).filter(Boolean))];
  const locs = [...new Set(allJobsCache.map((j) => j.location).filter(Boolean))];

  depts.forEach((d) => deptSelect.innerHTML += `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`);
  locs.forEach((l) => locSelect.innerHTML += `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`);

  const applyFilters = () => {
    const q = searchInput.value.toLowerCase().trim();
    const selDept = deptSelect.value;
    const selLoc = locSelect.value;
    const selType = typeSelect.value;

    const filtered = allJobsCache.filter((j) => {
      const matchQ = `${j.title} ${j.department} ${j.location} ${j.description}`.toLowerCase().includes(q);
      const matchDept = !selDept || j.department === selDept;
      const matchLoc = !selLoc || j.location === selLoc;
      const matchType = !selType || j.employment_type === selType;
      return matchQ && matchDept && matchLoc && matchType;
    });

    if (filtered.length === 0) {
      container.innerHTML = "";
      if (noMsg) noMsg.hidden = false;
    } else {
      if (noMsg) noMsg.hidden = true;
      container.innerHTML = filtered.map((j) => `
        <article class="job-card">
          <div>
            <h3 class="job-title">${escapeHtml(j.title)}</h3>
            <p class="job-meta">${escapeHtml(j.department)} · ${escapeHtml(j.employment_type)} ${j.salary_range ? `· ${escapeHtml(j.salary_range)}` : ''}</p>
          </div>
          <p class="job-detail">${escapeHtml(j.location)}</p>
          <button class="job-save-btn" data-save="${j.id}" title="Save job">♡</button>
          <button class="job-arrow" aria-label="Apply" data-apply="${j.id}">→</button>
        </article>
      `).join("");
      bindJobEvents(container);
    }
  };

  [searchInput, deptSelect, locSelect, typeSelect].forEach((el) => el?.addEventListener("input", applyFilters));
  applyFilters();
}

function bindJobEvents(container) {
  container.querySelectorAll("[data-apply]").forEach((btn) => btn.addEventListener("click", () => openApplicationModal(btn.dataset.apply)));
  container.querySelectorAll("[data-save]").forEach((btn) => btn.addEventListener("click", () => toggleSaveJob(btn.dataset.save, btn)));
}

// 3. Candidate Profile & Tracker Page (profile.html)
async function loadProfilePage() {
  const user = await refreshCurrentUser();
  if (!user) {
    openAuthDialog("Sign in to access your profile");
    return;
  }

  document.querySelector("[data-profile-name]").textContent = currentProfile?.full_name || "My Dashboard";
  document.querySelector("[data-profile-email]").textContent = user.email;

  // Prefill Form
  const form = document.querySelector("[data-profile-form]");
  if (form && currentProfile) {
    form.full_name.value = currentProfile.full_name || "";
    form.phone.value = currentProfile.phone || "";
    form.skills.value = currentProfile.skills || "";
    form.experience.value = currentProfile.experience || "";
    form.preferred_location.value = currentProfile.preferred_location || "";
    form.salary_expectations.value = currentProfile.salary_expectations || "";
    form.work_authorization.value = currentProfile.work_authorization || "";

    if (currentProfile.resume_path) {
      document.getElementById("current-cv-link").innerHTML = `
        <button type="button" class="button-text" style="font-size:12px;" onclick="viewResume('${currentProfile.resume_path}')">View uploaded CV ↗</button>
      `;
    }
  }

  // Load Candidate Applications
  const appsContainer = document.querySelector("[data-candidate-applications]");
  const { data: apps } = await supabaseClient
    .from("applications")
    .select("id, status, created_at, jobs(title, department, location)")
    .eq("candidate_id", user.id)
    .order("created_at", { ascending: false });

  document.querySelector("[data-candidate-apps-count]").textContent = `(${apps?.length || 0})`;
  if (appsContainer) {
    appsContainer.innerHTML = apps && apps.length ? apps.map((a) => `
      <article class="application">
        <h3>${escapeHtml(a.jobs?.title || "Role")}</h3>
        <p>${escapeHtml(a.jobs?.department || "")} · ${escapeHtml(a.jobs?.location || "")}</p>
        <div class="application-actions">
          <span class="status-pill status-${a.status}">${a.status}</span>
          <span style="font-size: 11px; color: var(--muted);">${new Date(a.created_at).toLocaleDateString()}</span>
        </div>
      </article>
    `).join("") : '<p class="empty-admin">You have not applied for any roles yet.</p>';
  }

  // Load Saved Jobs
  const savedContainer = document.querySelector("[data-candidate-saved]");
  const { data: saved } = await supabaseClient
    .from("saved_jobs")
    .select("id, jobs(*)")
    .eq("candidate_id", user.id);

  document.querySelector("[data-candidate-saved-count]").textContent = `(${saved?.length || 0})`;
  if (savedContainer) {
    savedContainer.innerHTML = saved && saved.length ? saved.map((s) => `
      <article class="application">
        <h3>${escapeHtml(s.jobs?.title)}</h3>
        <p>${escapeHtml(s.jobs?.department)} · ${escapeHtml(s.jobs?.location)}</p>
        <div class="application-actions">
          <a class="text-link" href="jobs.html">View on Job Board <span>→</span></a>
        </div>
      </article>
    `).join("") : '<p class="empty-admin">You have no saved jobs.</p>';
  }

  // Handle Profile Update
  form.onsubmit = async (e) => {
    e.preventDefault();
    const msg = form.querySelector(".form-message");
    showMessage(msg, "Saving changes...");

    let cvPath = currentProfile?.resume_path;
    const file = form.resume_file.files[0];
    if (file) {
      const ext = file.name.split(".").pop();
      cvPath = `${user.id}/${Date.now()}.${ext}`;
      await supabaseClient.storage.from("resumes").upload(cvPath, file, { upsert: true });
    }

    const { error } = await supabaseClient.from("profiles").update({
      full_name: form.full_name.value.trim(),
      phone: form.phone.value.trim(),
      skills: form.skills.value.trim(),
      experience: form.experience.value.trim(),
      preferred_location: form.preferred_location.value.trim(),
      salary_expectations: form.salary_expectations.value.trim(),
      work_authorization: form.work_authorization.value.trim(),
      resume_path: cvPath,
      updated_at: new Date().toISOString()
    }).eq("id", user.id);

    if (error) {
      showMessage(msg, error.message, true);
    } else {
      showMessage(msg, "Profile updated successfully!");
      await refreshCurrentUser();
    }
  };
}

// 4. Admin Panel (admin.html)
async function initAdminPage() {
  const loadingGate = document.querySelector("[data-admin-loading]");
  const loginGate = document.querySelector("[data-admin-login]");
  const deniedGate = document.querySelector("[data-admin-denied]");
  const adminPanel = document.querySelector("[data-admin-panel]");
  const loginForm = document.querySelector("[data-admin-login-form]");

  const checkAdmin = async () => {
    loadingGate.hidden = false;
    loginGate.hidden = true;
    deniedGate.hidden = true;
    adminPanel.hidden = true;

    const user = await refreshCurrentUser();
    loadingGate.hidden = true;

    if (!user) { loginGate.hidden = false; return; }

    const { data: adminRow } = await supabaseClient.from("admin_users").select("user_id").eq("user_id", user.id).maybeSingle();
    const isAgencyAdmin = Boolean(adminRow) || currentProfile?.role === "admin";

    if (isAgencyAdmin && !currentProfile?.is_blocked) {
      adminPanel.hidden = false;
      setupAdminTabs();
      renderAdminDashboard();
    } else {
      deniedGate.hidden = false;
    }
  };

  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = loginForm.querySelector(".form-message");
      const { error } = await supabaseClient.auth.signInWithPassword({
        email: loginForm.email.value.trim(),
        password: loginForm.password.value
      });
      if (error) showMessage(msg, error.message, true);
      else checkAdmin();
    });
  }

  document.querySelectorAll("[data-admin-sign-out]").forEach((btn) => btn.addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    checkAdmin();
  }));

  // Add / Edit Job
  const jobDialog = document.querySelector("[data-job-dialog]");
  const jobForm = document.querySelector("[data-job-form]");
  document.querySelector("[data-show-job-form]")?.addEventListener("click", () => {
    jobForm.reset();
    jobForm.job_id.value = "";
    document.querySelector("[data-job-modal-title]").textContent = "Add a new job";
    jobDialog.showModal();
  });

  jobForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = jobForm.querySelector(".form-message");
    const jobId = jobForm.job_id.value;

    const payload = {
      title: jobForm.title.value.trim(),
      location: jobForm.location.value.trim(),
      employment_type: jobForm.employment_type.value,
      department: jobForm.department.value.trim(),
      salary_range: jobForm.salary_range.value.trim(),
      description: jobForm.description.value.trim(),
      is_featured: jobForm.is_featured.checked
    };

    let res;
    if (jobId) {
      res = await supabaseClient.from("jobs").update(payload).eq("id", jobId);
    } else {
      res = await supabaseClient.from("jobs").insert(payload);
    }

    if (res.error) showMessage(msg, res.error.message, true);
    else {
      jobDialog.close();
      renderAdminDashboard();
    }
  });

  checkAdmin();
}

function setupAdminTabs() {
  document.querySelectorAll(".admin-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".admin-tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".admin-tab-content").forEach((c) => c.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.tab).classList.add("active");
    });
  });
}

async function renderAdminDashboard() {
  // Fetch All Jobs, Applications, Users
  const [jobsRes, appsRes, usersRes] = await Promise.all([
    supabaseClient.from("jobs").select("*").order("created_at", { ascending: false }),
    supabaseClient.from("applications").select("*, jobs(title)").order("created_at", { ascending: false }),
    supabaseClient.from("profiles").select("*").order("created_at", { ascending: false })
  ]);

  const jobs = jobsRes.data || [];
  const apps = appsRes.data || [];
  const users = usersRes.data || [];

  document.querySelector("[data-job-count]").textContent = `(${jobs.length})`;
  document.querySelector("[data-application-count]").textContent = `(${apps.length})`;
  document.querySelector("[data-user-count]").textContent = `(${users.length})`;

  // 1. Render Jobs
  const jobsList = document.querySelector("[data-admin-jobs]");
  jobsList.innerHTML = jobs.length ? jobs.map((j) => `
    <article class="admin-job">
      <div>
        <h3>${escapeHtml(j.title)} ${j.is_open ? '' : '<span class="closed-label">(Closed)</span>'} ${j.is_featured ? '<span class="featured-badge">Featured</span>' : ''}</h3>
        <p>${escapeHtml(j.department)} · ${escapeHtml(j.location)} · ${escapeHtml(j.employment_type)}</p>
      </div>
      <div style="display: flex; gap: 8px;">
        <button class="delete-job" style="color: var(--ink);" onclick="toggleJobStatus('${j.id}', ${j.is_open})">${j.is_open ? 'Close' : 'Open'}</button>
        <button class="delete-job" onclick="deleteJob('${j.id}')">Delete</button>
      </div>
    </article>
  `).join("") : '<p class="empty-admin">No jobs posted yet.</p>';

  // 2. Render Applications
  const appsList = document.querySelector("[data-applications]");
  appsList.innerHTML = apps.length ? apps.map((a) => `
    <article class="application">
      <h3>${escapeHtml(a.full_name)} — <span style="font-weight: 400; color: var(--muted);">${escapeHtml(a.jobs?.title || "Role")}</span></h3>
      <p>Email: ${escapeHtml(a.email)} | Phone: ${escapeHtml(a.phone)}</p>
      ${a.message ? `<p style="margin-top:4px; font-style:italic;">"${escapeHtml(a.message)}"</p>` : ''}
      <div class="application-actions">
        <button type="button" onclick="viewResume('${a.resume_path}')">Download CV</button>
        <label>Status:
          <select onchange="updateApplicationStatus('${a.id}', this.value)">
            <option value="received" ${a.status === 'received' ? 'selected' : ''}>Received</option>
            <option value="shortlisted" ${a.status === 'shortlisted' ? 'selected' : ''}>Shortlisted</option>
            <option value="interview" ${a.status === 'interview' ? 'selected' : ''}>Interview</option>
            <option value="hired" ${a.status === 'hired' ? 'selected' : ''}>Hired</option>
            <option value="rejected" ${a.status === 'rejected' ? 'selected' : ''}>Rejected</option>
          </select>
        </label>
      </div>
    </article>
  `).join("") : '<p class="empty-admin">No applications received yet.</p>';

  // 3. Render Registered Users
  const usersList = document.querySelector("[data-admin-users]");
  usersList.innerHTML = users.length ? users.map((u) => `
    <article class="admin-job">
      <div>
        <h3>${escapeHtml(u.full_name)} (${escapeHtml(u.role)}) ${u.is_blocked ? '<span style="color:red; font-size:11px; font-weight:700;">[BLOCKED]</span>' : ''}</h3>
        <p>${escapeHtml(u.email)} | Phone: ${escapeHtml(u.phone || 'N/A')}</p>
        <p style="font-size:11px; color:var(--muted);">Skills: ${escapeHtml(u.skills || 'None listed')}</p>
      </div>
      <div style="display: flex; gap: 8px;">
        <button class="delete-job" style="color: var(--ink);" onclick="toggleUserBlock('${u.id}', ${u.is_blocked})">${u.is_blocked ? 'Unblock' : 'Block'}</button>
      </div>
    </article>
  `).join("") : '<p class="empty-admin">No registered users found.</p>';
}

// Global Helpers for Inline Handlers
window.viewResume = async (path) => {
  const { data } = await supabaseClient.storage.from("resumes").createSignedUrl(path, 60);
  if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  else alert("Resume file not found.");
};

window.toggleJobStatus = async (id, isOpen) => {
  await supabaseClient.from("jobs").update({ is_open: !isOpen }).eq("id", id);
  renderAdminDashboard();
};

window.deleteJob = async (id) => {
  if (confirm("Delete this listing permanently?")) {
    await supabaseClient.from("jobs").delete().eq("id", id);
    renderAdminDashboard();
  }
};

window.updateApplicationStatus = async (id, status) => {
  await supabaseClient.from("applications").update({ status }).eq("id", id);
};

window.toggleUserBlock = async (id, isBlocked) => {
  await supabaseClient.from("profiles").update({ is_blocked: !isBlocked }).eq("id", id);
  renderAdminDashboard();
};

// ----------------------------------------------------
// BOOTSTRAPPER
// ----------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  document.querySelectorAll("[data-year]").forEach((y) => y.textContent = new Date().getFullYear());
  document.querySelectorAll("[data-close-dialog]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));

  const menuBtn = document.querySelector(".menu-button");
  if (menuBtn) menuBtn.addEventListener("click", () => document.querySelector(".main-nav").classList.toggle("open"));

  await refreshCurrentUser();
  setupAuthModal();
  setupApplicationModal();

  document.querySelectorAll("[data-open-auth]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (currentUser) {
        await supabaseClient.auth.signOut();
        await refreshCurrentUser();
        if (window.location.pathname.includes("profile.html")) window.location.href = "index.html";
      } else {
        openAuthDialog();
      }
    });
  });

  document.querySelector("[data-profile-sign-out]")?.addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    window.location.href = "index.html";
  });

  const page = document.body.dataset.page;
  if (page === "home") initHomePage();
  else if (page === "jobs") initJobsPage();
  else if (page === "profile") loadProfilePage();
  else if (page === "admin") initAdminPage();
});
