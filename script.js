const config = window.NORTHSTAR_SUPABASE_CONFIG;
const supabaseClient = window.supabase.createClient(config.url, config.publishableKey);
let currentUser = null;
let jobsCache = [];
let pendingJobId = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" })[char]);
}

function showMessage(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle("is-error", isError);
}

function setAuthButton() {
  document.querySelectorAll("[data-open-auth]").forEach((button) => {
    button.textContent = currentUser ? "Sign out" : "Sign in";
    button.classList.toggle("is-signed-in", Boolean(currentUser));
  });
}

async function refreshCurrentUser() {
  const { data, error } = await supabaseClient.auth.getUser();
  currentUser = error ? null : data.user;
  setAuthButton();
  return currentUser;
}

function jobCard(job) {
  return `<article class="job-card">
    <div><h3 class="job-title">${escapeHtml(job.title)}</h3><p class="job-meta">${escapeHtml(job.department)} · ${escapeHtml(job.employment_type)}</p></div>
    <p class="job-detail">${escapeHtml(job.location)}</p>
    <button class="job-arrow" aria-label="Apply for ${escapeHtml(job.title)}" data-apply-job="${job.id}">→</button>
  </article>`;
}

function bindApplicationButtons() {
  document.querySelectorAll("[data-apply-job]").forEach((button) => {
    button.addEventListener("click", () => openApplication(button.dataset.applyJob));
  });
}

async function renderJobs() {
  const list = document.querySelector("[data-jobs]");
  if (!list) return;
  const { data, error } = await supabaseClient.from("jobs").select("*").eq("is_open", true).order("created_at", { ascending: false });
  if (error) {
    list.innerHTML = '<p class="empty-state">Jobs are temporarily unavailable. Please try again shortly.</p>';
    return;
  }
  jobsCache = data;
  const search = document.querySelector("[data-job-search]");
  const empty = document.querySelector(".empty-state");
  const draw = () => {
    const term = search.value.toLowerCase().trim();
    const visibleJobs = jobsCache.filter((job) => `${job.title} ${job.location} ${job.department}`.toLowerCase().includes(term));
    list.innerHTML = visibleJobs.map(jobCard).join("");
    empty.hidden = Boolean(visibleJobs.length);
    bindApplicationButtons();
  };
  search.addEventListener("input", draw);
  draw();
}

async function openApplication(jobId) {
  const job = jobsCache.find((item) => String(item.id) === String(jobId));
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
  showMessage(dialog.querySelector(".form-message"), "");
  dialog.showModal();
}

function openAuthDialog(heading = "Sign in to apply") {
  const dialog = document.querySelector("[data-auth-dialog]");
  if (!dialog) return;
  dialog.querySelector("[data-auth-heading]").textContent = heading;
  showMessage(dialog.querySelector(".form-message"), "");
  dialog.showModal();
}

function setupAuthDialog() {
  const form = document.querySelector("[data-auth-form]");
  if (!form) return;
  let isSignUp = false;
  const heading = form.querySelector("[data-auth-heading]");
  const submit = form.querySelector("[data-auth-submit]");
  const toggle = form.querySelector("[data-auth-toggle]");
  const message = form.querySelector(".form-message");
  const setMode = () => {
    heading.textContent = isSignUp ? "Create your account" : "Sign in to apply";
    submit.innerHTML = `${isSignUp ? "Create account" : "Sign in"} <span>→</span>`;
    toggle.textContent = isSignUp ? "Already have an account? Sign in" : "New here? Create an account";
    form.elements.password.autocomplete = isSignUp ? "new-password" : "current-password";
    showMessage(message, "");
  };
  toggle.addEventListener("click", () => { isSignUp = !isSignUp; setMode(); });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;
    submit.disabled = true;
    showMessage(message, isSignUp ? "Creating your account…" : "Signing you in…");
    const result = isSignUp
      ? await supabaseClient.auth.signUp({ email, password, options: { emailRedirectTo: window.location.href } })
      : await supabaseClient.auth.signInWithPassword({ email, password });
    submit.disabled = false;
    if (result.error) { showMessage(message, result.error.message, true); return; }
    if (isSignUp && !result.data.session) {
      showMessage(message, "Check your email to confirm your account, then sign in.");
      return;
    }
    await refreshCurrentUser();
    form.reset();
    form.closest("dialog").close();
    if (pendingJobId) openApplication(pendingJobId);
  });
}

async function setupApplicationForm() {
  const form = document.querySelector("[data-apply-form]");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = form.querySelector(".form-message");
    const user = await refreshCurrentUser();
    if (!user) { form.closest("dialog").close(); openAuthDialog("Sign in to submit your application"); return; }
    const file = form.elements.resume.files[0];
    if (!file) { showMessage(message, "Please choose your résumé file.", true); return; }
    if (file.size > 5 * 1024 * 1024) { showMessage(message, "Your résumé must be 5 MB or smaller.", true); return; }
    const extension = file.name.split(".").pop().toLowerCase();
    if (!['pdf', 'doc', 'docx'].includes(extension)) { showMessage(message, "Please upload a PDF, DOC, or DOCX résumé.", true); return; }
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    showMessage(message, "Uploading your résumé securely…");
    const resumePath = `${user.id}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabaseClient.storage.from("resumes").upload(resumePath, file, { contentType: file.type || undefined, upsert: false });
    if (uploadError) { submit.disabled = false; showMessage(message, uploadError.message, true); return; }
    const { error: applicationError } = await supabaseClient.from("applications").insert({
      job_id: Number(form.elements.jobId.value),
      candidate_id: user.id,
      full_name: form.elements.name.value.trim(),
      email: user.email,
      phone: form.elements.phone.value.trim(),
      message: form.elements.message.value.trim() || null,
      resume_path: resumePath
    });
    if (applicationError) {
      await supabaseClient.storage.from("resumes").remove([resumePath]);
      submit.disabled = false;
      const duplicate = applicationError.code === "23505";
      showMessage(message, duplicate ? "You have already applied for this role." : applicationError.message, true);
      return;
    }
    form.reset();
    form.elements.email.value = user.email || "";
    submit.disabled = false;
    showMessage(message, "Thank you—your application has been received.");
  });
}

function setupContactForm() {
  const form = document.querySelector("[data-contact-form]");
  if (!form) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    form.reset();
    showMessage(form.querySelector(".form-message"), "Thanks for reaching out. We’ll be in touch shortly.");
  });
}

async function isAdmin(userId) {
  const { data, error } = await supabaseClient.from("admin_users").select("user_id").eq("user_id", userId).maybeSingle();
  return !error && Boolean(data);
}

function showAdminSection(selector) {
  document.querySelectorAll("[data-admin-loading], [data-admin-login], [data-admin-denied], [data-admin-panel]").forEach((section) => { section.hidden = true; });
  document.querySelector(selector).hidden = false;
}

async function showResume(path) {
  const { data, error } = await supabaseClient.storage.from("resumes").createSignedUrl(path, 60);
  if (error) { window.alert("The résumé could not be opened. Please try again."); return; }
  window.open(data.signedUrl, "_blank", "noopener,noreferrer");
}

async function setupAdmin() {
  const list = document.querySelector("[data-admin-jobs]");
  if (!list) return;
  const loginForm = document.querySelector("[data-admin-login-form]");
  const loadAdmin = async () => {
    const user = await refreshCurrentUser();
    if (!user) { showAdminSection("[data-admin-login]"); return; }
    if (!await isAdmin(user.id)) { showAdminSection("[data-admin-denied]"); return; }
    showAdminSection("[data-admin-panel]");
    await window.renderAdmin();
  };
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = loginForm.querySelector(".form-message");
    const submit = loginForm.querySelector('[type="submit"]');
    submit.disabled = true;
    const { error } = await supabaseClient.auth.signInWithPassword({ email: loginForm.elements.email.value.trim(), password: loginForm.elements.password.value });
    submit.disabled = false;
    if (error) { showMessage(message, error.message, true); return; }
    await loadAdmin();
  });
  document.querySelectorAll("[data-admin-sign-out]").forEach((button) => button.addEventListener("click", async () => { await supabaseClient.auth.signOut(); await loadAdmin(); }));
  document.querySelector("[data-show-job-form]").addEventListener("click", () => document.querySelector("[data-job-dialog]").showModal());
  document.querySelector("[data-job-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = form.querySelector(".form-message");
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    const job = Object.fromEntries(new FormData(form).entries());
    const { error } = await supabaseClient.from("jobs").insert(job);
    submit.disabled = false;
    if (error) { showMessage(message, error.message, true); return; }
    form.reset(); form.closest("dialog").close(); await window.renderAdmin(); await renderJobs();
  });
  window.renderAdmin = async () => {
    const applicationsList = document.querySelector("[data-applications]");
    const [jobsResult, applicationsResult] = await Promise.all([
      supabaseClient.from("jobs").select("*").order("created_at", { ascending: false }),
      supabaseClient.from("applications").select("id, full_name, email, phone, status, resume_path, created_at, jobs(title)").order("created_at", { ascending: false })
    ]);
    if (jobsResult.error || applicationsResult.error) { showAdminSection("[data-admin-denied]"); return; }
    const jobs = jobsResult.data;
    const applications = applicationsResult.data;
    document.querySelector("[data-job-count]").textContent = `(${jobs.filter((job) => job.is_open).length} open)`;
    document.querySelector("[data-application-count]").textContent = `(${applications.length})`;
    list.innerHTML = jobs.length ? jobs.map((job) => `<article class="admin-job"><div><h3>${escapeHtml(job.title)} ${job.is_open ? "" : '<span class="closed-label">Closed</span>'}</h3><p>${escapeHtml(job.location)} · ${escapeHtml(job.employment_type)}</p></div>${job.is_open ? `<button class="delete-job" data-close-job="${job.id}">Close role</button>` : ""}</article>`).join("") : '<p class="empty-admin">No roles yet.</p>';
    applicationsList.innerHTML = applications.length ? applications.map((application) => `<article class="application"><h3>${escapeHtml(application.full_name)}</h3><p>${escapeHtml(application.jobs?.title || "Role unavailable")} · ${escapeHtml(application.email)}</p><div class="application-actions"><button data-view-resume="${escapeHtml(application.resume_path)}">View résumé</button><label>Status<select data-application-status="${application.id}"><option value="received" ${application.status === "received" ? "selected" : ""}>Received</option><option value="reviewing" ${application.status === "reviewing" ? "selected" : ""}>Reviewing</option><option value="interview" ${application.status === "interview" ? "selected" : ""}>Interview</option><option value="rejected" ${application.status === "rejected" ? "selected" : ""}>Rejected</option><option value="hired" ${application.status === "hired" ? "selected" : ""}>Hired</option></select></label></div></article>`).join("") : '<p class="empty-admin">Applications will appear here.</p>';
    document.querySelectorAll("[data-close-job]").forEach((button) => button.addEventListener("click", async () => { await supabaseClient.from("jobs").update({ is_open: false, updated_at: new Date().toISOString() }).eq("id", button.dataset.closeJob); await window.renderAdmin(); await renderJobs(); }));
    document.querySelectorAll("[data-view-resume]").forEach((button) => button.addEventListener("click", () => showResume(button.dataset.viewResume)));
    document.querySelectorAll("[data-application-status]").forEach((select) => select.addEventListener("change", async () => { await supabaseClient.from("applications").update({ status: select.value }).eq("id", select.dataset.applicationStatus); }));
  };
  await loadAdmin();
}

document.addEventListener("DOMContentLoaded", async () => {
  document.querySelectorAll("[data-year]").forEach((year) => { year.textContent = new Date().getFullYear(); });
  document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
  const menuButton = document.querySelector(".menu-button");
  if (menuButton) menuButton.addEventListener("click", () => { const nav = document.querySelector(".main-nav"); const isOpen = nav.classList.toggle("open"); menuButton.setAttribute("aria-expanded", isOpen); });
  await refreshCurrentUser();
  document.querySelectorAll("[data-open-auth]").forEach((button) => button.addEventListener("click", async () => {
    if (currentUser) { await supabaseClient.auth.signOut(); await refreshCurrentUser(); return; }
    openAuthDialog();
  }));
  supabaseClient.auth.onAuthStateChange((_event, session) => { currentUser = session?.user || null; setAuthButton(); });
  await renderJobs();
  setupAuthDialog();
  setupApplicationForm();
  setupContactForm();
  await setupAdmin();
});
