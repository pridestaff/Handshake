const config = window.NORTHSTAR_SUPABASE_CONFIG;
const supabaseClient = window.supabase.createClient(config.url, config.publishableKey);
let currentUser = null;
let currentProfile = null;
let allJobsCache = [];
let allUsersCache = [];
let allAppsCache = [];
let pendingJobId = null;
let pendingJobTitle = null;
let pendingRedirectUrl = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" })[c]);
}

function showMessage(el, msg, isError = false) {
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle("is-error", isError);
}

async function refreshCurrentUser() {
  try {
    const { data, error } = await supabaseClient.auth.getUser();
    currentUser = error ? null : data?.user;
    
    if (currentUser) {
      const { data: profile } = await supabaseClient.from("profiles").select("*").eq("id", currentUser.id).maybeSingle();
      currentProfile = profile;
    } else {
      currentProfile = null;
    }
  } catch (err) {
    currentUser = null;
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

function bindTagCloud(cloudContainer, targetInput) {
  if (!cloudContainer || !targetInput) return;

  const syncInputToTags = () => {
    const activeTags = Array.from(cloudContainer.querySelectorAll(".tag-chip.active")).map((c) => c.dataset.tag);
    const typedTags = targetInput.value
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t && !activeTags.includes(t));
    
    targetInput.value = [...activeTags, ...typedTags].join(", ");
  };

  const syncTagsToInput = () => {
    const currentTags = targetInput.value.split(",").map((t) => t.trim().toLowerCase());
    cloudContainer.querySelectorAll(".tag-chip").forEach((chip) => {
      const tagVal = chip.dataset.tag.toLowerCase();
      chip.classList.toggle("active", currentTags.includes(tagVal));
    });
  };

  cloudContainer.querySelectorAll(".tag-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      chip.classList.toggle("active");
      syncInputToTags();
    });
  });

  targetInput.addEventListener("input", syncTagsToInput);
  syncTagsToInput();
}

function openAuthDialog(heading = "Sign in to your account") {
  const dialog = document.querySelector("[data-auth-dialog]");
  if (!dialog) return;
  const headingEl = dialog.querySelector("[data-auth-heading]");
  if (headingEl) headingEl.textContent = heading;
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
  const signupFields = form.querySelector("[data-signup-fields]");

  const setMode = () => {
    heading.textContent = isSignUp ? "Create your account" : "Sign in to your account";
    submit.innerHTML = `${isSignUp ? "Create account" : "Sign in"} <span>→</span>`;
    toggle.textContent = isSignUp ? "Already have an account? Sign in" : "New here? Create an account";
    
    if (signupFields) {
      signupFields.hidden = !isSignUp;
      form.elements.first_name.required = isSignUp;
      form.elements.last_name.required = isSignUp;
      form.elements.phone.required = isSignUp;
      form.elements.gender.required = isSignUp;
    }
    
    showMessage(message, "");
  };

  toggle.addEventListener("click", () => { isSignUp = !isSignUp; setMode(); });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;
    submit.disabled = true;
    showMessage(message, isSignUp ? "Creating your account..." : "Signing you in...");

    try {
      if (isSignUp) {
        const firstName = form.elements.first_name.value.trim();
        const lastName = form.elements.last_name.value.trim();
        const phone = form.elements.phone.value.trim();
        const gender = form.elements.gender.value;

        if (!firstName || !lastName || !phone || !gender) {
          throw new Error("Please fill in First Name, Last Name, Mobile Number, and Gender.");
        }

        const fullName = `${firstName} ${lastName}`.trim();

        const { data, error } = await supabaseClient.auth.signUp({
          email,
          password,
          options: {
            data: {
              first_name: firstName,
              last_name: lastName,
              full_name: fullName,
              phone: phone,
              gender: gender
            }
          }
        });

        if (error) throw error;

        if (data?.user) {
          await supabaseClient.from("profiles").upsert({
            id: data.user.id,
            first_name: firstName,
            last_name: lastName,
            full_name: fullName,
            email: email,
            phone: phone,
            gender: gender,
            role: "candidate"
          });
        }

        showMessage(message, "Account created successfully!");
      } else {
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }

      await refreshCurrentUser();
      form.reset();
      form.closest("dialog").close();
      
      if (pendingJobId) {
        openApplicationModal(pendingJobId, pendingJobTitle, pendingRedirectUrl);
      }
      if (window.location.pathname.includes("profile.html")) loadProfilePage();
    } catch (err) {
      showMessage(message, err.message, true);
    } finally {
      submit.disabled = false;
    }
  });
}

function openApplicationModal(jobId, jobTitle = null, redirectUrl = null) {
  pendingJobId = jobId;
  pendingJobTitle = jobTitle;
  pendingRedirectUrl = redirectUrl;

  const dialog = document.querySelector("[data-apply-dialog]");
  if (!dialog) return;

  const titleEl = dialog.querySelector("[data-application-title]");
  if (titleEl) titleEl.textContent = jobTitle ? `Apply for ${jobTitle}` : "Apply for this role";
  
  dialog.querySelector('[name="jobId"]').value = jobId || "";
  
  const nameInput = dialog.querySelector('[name="name"]');
  const emailInput = dialog.querySelector('[name="email"]');
  const phoneInput = dialog.querySelector('[name="phone"]');
  const resumeInput = dialog.querySelector('[name="resume"]');
  const cvIndicator = document.getElementById("modal-cv-indicator");
  const guestPasswordField = document.getElementById("guest-password-field");

  if (currentUser) {
    // Registered / Logged In Candidate
    emailInput.value = currentUser.email || "";
    emailInput.readOnly = true;
    if (guestPasswordField) guestPasswordField.hidden = true;

    if (currentProfile) {
      nameInput.value = currentProfile.full_name || `${currentProfile.first_name || ''} ${currentProfile.last_name || ''}`.trim();
      phoneInput.value = currentProfile.phone || "";

      if (currentProfile.resume_path && cvIndicator) {
        cvIndicator.hidden = false;
        cvIndicator.className = "cv-present-badge";
        cvIndicator.innerHTML = `✓ Active CV on file. (Upload file only to replace)`;
        if (resumeInput) resumeInput.required = false;
      } else {
        if (cvIndicator) cvIndicator.hidden = true;
        if (resumeInput) resumeInput.required = true;
      }
    }
  } else {
    // Non-Registered / Guest Candidate
    emailInput.value = "";
    emailInput.readOnly = false;
    nameInput.value = "";
    phoneInput.value = "";
    if (guestPasswordField) guestPasswordField.hidden = false;
    if (cvIndicator) cvIndicator.hidden = true;
    if (resumeInput) resumeInput.required = true;
  }

  showMessage(dialog.querySelector(".form-message"), "");
  dialog.showModal();
}

function setupApplicationModal() {
  const form = document.querySelector("[data-apply-form]");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = form.querySelector(".form-message");
    const submitBtn = form.querySelector('[type="submit"]');

    let activeUser = await refreshCurrentUser();
    const candidateName = form.elements.name.value.trim();
    const candidateEmail = form.elements.email.value.trim();
    const candidatePhone = form.elements.phone.value.trim();
    const candidateMessage = form.elements.message.value.trim();
    const file = form.elements.resume?.files?.[0];
    const guestPassword = form.elements.guest_password ? form.elements.guest_password.value : null;

    submitBtn.disabled = true;
    showMessage(msg, "Processing your application...");

    try {
      // 1. If not logged in, auto-create their account or sign up
      if (!activeUser) {
        if (!guestPassword || guestPassword.length < 6) {
          throw new Error("Please create a password (at least 6 characters) for your candidate profile.");
        }

        const { data: authData, error: authErr } = await supabaseClient.auth.signUp({
          email: candidateEmail,
          password: guestPassword,
          options: {
            data: { full_name: candidateName, phone: candidatePhone }
          }
        });

        if (authErr) throw authErr;
        activeUser = authData?.user;

        if (activeUser) {
          await supabaseClient.from("profiles").upsert({
            id: activeUser.id,
            full_name: candidateName,
            email: candidateEmail,
            phone: candidatePhone,
            role: "candidate"
          });
        }
      }

      const userId = activeUser ? activeUser.id : crypto.randomUUID();
      let resumePath = currentProfile?.resume_path;

      // 2. Upload Resume if provided
      if (file) {
        if (file.size > 5 * 1024 * 1024) throw new Error("Resume must be 5 MB or smaller.");
        const ext = file.name.split(".").pop().toLowerCase();
        if (!['pdf', 'doc', 'docx'].includes(ext)) throw new Error("Please upload a PDF or DOC/DOCX file.");

        showMessage(msg, "Uploading résumé securely...");
        resumePath = `${userId}/${Date.now()}.${ext}`;
        const { error: upErr } = await supabaseClient.storage.from("resumes").upload(resumePath, file, { upsert: true });
        if (upErr) throw upErr;
      }

      if (!resumePath) {
        throw new Error("Please upload a résumé file to submit your application.");
      }

      // 3. Save Candidate Profile Updates
      if (activeUser) {
        await supabaseClient.from("profiles").update({
          full_name: candidateName,
          phone: candidatePhone,
          resume_path: resumePath
        }).eq("id", activeUser.id);
      }

      // 4. Insert Application Record
      const { error: appErr } = await supabaseClient.from("applications").insert({
        job_id: form.elements.jobId.value,
        candidate_id: userId,
        full_name: candidateName,
        email: candidateEmail,
        phone: candidatePhone,
        message: candidateMessage || null,
        resume_path: resumePath,
        status: "received"
      });

      if (appErr && appErr.code !== "23505") throw appErr;

      await refreshCurrentUser();

      // 5. Handle Redirection if set
      if (pendingRedirectUrl && pendingRedirectUrl.trim() !== "") {
        showMessage(msg, "Application submitted! Redirecting to the application portal...");
        setTimeout(() => {
          window.location.href = pendingRedirectUrl;
        }, 1200);
      } else {
        showMessage(msg, "Application submitted successfully! Our team will review your CV.");
        setTimeout(() => { 
          form.reset(); 
          form.closest("dialog").close(); 
        }, 1800);
      }
    } catch (err) {
      showMessage(msg, err.message, true);
    } finally {
      submitBtn.disabled = false;
    }
  });
}

async function toggleSaveJob(jobId, btn) {
  if (!currentUser) {
    openAuthDialog("Sign in to save jobs");
    return;
  }
  const { data: existing } = await supabaseClient.from("saved_jobs").select("id").eq("candidate_id", currentUser.id).eq("job_id", jobId).maybeSingle();
  if (existing) {
    await supabaseClient.from("saved_jobs").delete().eq("id", existing.id);
    if (btn) btn.textContent = btn.textContent.includes("Save") ? "Save Job ♡" : "♡";
  } else {
    await supabaseClient.from("saved_jobs").insert({ candidate_id: currentUser.id, job_id: jobId });
    if (btn) btn.textContent = btn.textContent.includes("Save") ? "Saved ♥" : "♥";
  }
}

function setupContactForm() {
  const form = document.querySelector("[data-contact-form]");
  const successModal = document.querySelector("[data-contact-success-dialog]");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = form.querySelector(".form-message");
    const submitBtn = form.querySelector('[type="submit"]');

    submitBtn.disabled = true;
    showMessage(msg, "Submitting your enquiry...");

    const payload = {
      name: form.elements.name.value.trim(),
      email: form.elements.email.value.trim(),
      interest: form.elements.interest.value,
      message: form.elements.message.value.trim()
    };

    const { error } = await supabaseClient.from("contact_messages").insert(payload);
    submitBtn.disabled = false;

    if (error) {
      showMessage(msg, "Failed to submit: " + error.message, true);
    } else {
      form.reset();
      showMessage(msg, "");
      if (successModal) {
        successModal.showModal();
      } else {
        alert("Your enquiry has been submitted successfully!");
      }
    }
  });
}

// ----------------------------------------------------
// PAGE: HOMEPAGE (index.html)
// ----------------------------------------------------
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
    <article class="job-card" style="cursor: pointer;" onclick="window.location.href='job.html?id=${j.id}'">
      <div>
        <h3 class="job-title"><a href="job.html?id=${j.id}" style="color:inherit;">${escapeHtml(j.title)}</a> ${j.is_featured ? '<span class="featured-badge">Featured</span>' : ''}</h3>
        <p class="job-meta">${escapeHtml(j.department)} · ${escapeHtml(j.employment_type)}</p>
      </div>
      <p class="job-detail">${escapeHtml(j.location)}</p>
      <button class="job-save-btn" data-save="${j.id}" title="Save role" onclick="event.stopPropagation();">♡</button>
      <a class="job-arrow" href="job.html?id=${j.id}" aria-label="View role details">→</a>
    </article>
  `).join("");

  container.querySelectorAll("[data-save]").forEach((btn) => {
    btn.addEventListener("click", () => toggleSaveJob(btn.dataset.save, btn));
  });
}

// ----------------------------------------------------
// PAGE: ALL JOBS BOARD (jobs.html)
// ----------------------------------------------------
async function initJobsPage() {
  const container = document.querySelector("[data-all-jobs]");
  const noMsg = document.querySelector("[data-no-jobs-msg]");
  if (!container) return;

  const { data: jobs } = await supabaseClient.from("jobs").select("*").eq("is_open", true).order("created_at", { ascending: false });
  allJobsCache = jobs || [];

  const deptSelect = document.querySelector("[data-filter-department]");
  const locSelect = document.querySelector("[data-filter-location]");
  const typeSelect = document.querySelector("[data-filter-type]");
  const searchInput = document.querySelector("[data-filter-search]");
  const chipContainer = document.querySelector("[data-job-filter-chips]");

  const depts = [...new Set(allJobsCache.map((j) => j.department).filter(Boolean))];
  const locs = [...new Set(allJobsCache.map((j) => j.location).filter(Boolean))];

  if (deptSelect) depts.forEach((d) => deptSelect.innerHTML += `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`);
  if (locSelect) locs.forEach((l) => locSelect.innerHTML += `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`);

  let activeFilterTag = "";

  if (chipContainer) {
    chipContainer.querySelectorAll(".tag-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        if (chip.classList.contains("active")) {
          chip.classList.remove("active");
          activeFilterTag = "";
        } else {
          chipContainer.querySelectorAll(".tag-chip").forEach((c) => c.classList.remove("active"));
          chip.classList.add("active");
          activeFilterTag = chip.dataset.tag.toLowerCase();
        }
        applyFilters();
      });
    });
  }

  const applyFilters = () => {
    const q = searchInput ? searchInput.value.toLowerCase().trim() : "";
    const selDept = deptSelect ? deptSelect.value : "";
    const selLoc = locSelect ? locSelect.value : "";
    const selType = typeSelect ? typeSelect.value : "";

    const filtered = allJobsCache.filter((j) => {
      const fullText = `${j.title} ${j.department} ${j.location} ${j.description} ${j.requirements || ''} ${j.employment_type}`.toLowerCase();
      const matchQ = fullText.includes(q);
      const matchTag = !activeFilterTag || fullText.includes(activeFilterTag);
      const matchDept = !selDept || j.department === selDept;
      const matchLoc = !selLoc || j.location === selLoc;
      const matchType = !selType || j.employment_type === selType;
      return matchQ && matchTag && matchDept && matchLoc && matchType;
    });

    if (filtered.length === 0) {
      container.innerHTML = "";
      if (noMsg) noMsg.hidden = false;
    } else {
      if (noMsg) noMsg.hidden = true;
      container.innerHTML = filtered.map((j) => `
        <article class="job-card" style="cursor: pointer;" onclick="window.location.href='job.html?id=${j.id}'">
          <div>
            <h3 class="job-title"><a href="job.html?id=${j.id}" style="color:inherit;">${escapeHtml(j.title)}</a></h3>
            <p class="job-meta">${escapeHtml(j.department)} · ${escapeHtml(j.employment_type)} ${j.salary_range ? `· ${escapeHtml(j.salary_range)}` : ''}</p>
          </div>
          <p class="job-detail">${escapeHtml(j.location)}</p>
          <button class="job-save-btn" data-save="${j.id}" title="Save role" onclick="event.stopPropagation();">♡</button>
          <a class="job-arrow" href="job.html?id=${j.id}" aria-label="View job">→</a>
        </article>
      `).join("");
      
      container.querySelectorAll("[data-save]").forEach((btn) => {
        btn.addEventListener("click", () => toggleSaveJob(btn.dataset.save, btn));
      });
    }
  };

  [searchInput, deptSelect, locSelect, typeSelect].forEach((el) => el?.addEventListener("input", applyFilters));
  applyFilters();
}

// ----------------------------------------------------
// PAGE: DEDICATED SINGLE JOB PAGE (job.html)
// ----------------------------------------------------
async function initSingleJobPage() {
  const params = new URLSearchParams(window.location.search);
  const jobId = params.get("id");

  const loadingMsg = document.getElementById("job-loading-msg");
  const fullDetails = document.getElementById("job-full-details");

  if (!jobId) {
    if (loadingMsg) loadingMsg.innerHTML = '<p class="empty-state">No role selected. <a href="jobs.html" class="text-link">View all vacancies →</a></p>';
    return;
  }

  const { data: job, error } = await supabaseClient.from("jobs").select("*").eq("id", jobId).maybeSingle();

  if (error || !job) {
    if (loadingMsg) loadingMsg.innerHTML = '<p class="empty-state">This job listing could not be found or has been removed. <a href="jobs.html" class="text-link">Browse other roles →</a></p>';
    return;
  }

  // Update Page Title and Header
  document.title = `${job.title} | ${job.company_name || "Northstar Talent"}`;
  document.querySelector("[data-job-title]").textContent = job.title;
  document.querySelector("[data-job-department]").textContent = job.department || "General";
  document.querySelector("[data-job-company]").textContent = `${job.company_name || "Northstar Talent"} • Active Opening`;

  // Status Pill
  const statusPill = document.querySelector("[data-job-status-pill]");
  if (statusPill) {
    statusPill.textContent = job.is_open ? "Active Opening" : "Position Closed";
    statusPill.className = `status-pill ${job.is_open ? 'status-hired' : 'status-rejected'}`;
  }

  // Metadata Grid
  document.querySelector("[data-job-client]").textContent = job.company_name || "Northstar Talent";
  document.querySelector("[data-job-location]").textContent = job.location || "Remote";
  document.querySelector("[data-job-type]").textContent = job.employment_type || "Full-time";
  document.querySelector("[data-job-salary]").textContent = job.salary_range || "Competitive Market Rate";
  document.querySelector("[data-job-deadline]").textContent = job.application_deadline || "Open until filled";
  document.querySelector("[data-job-date]").textContent = new Date(job.created_at).toLocaleDateString();

  // Content Sections
  document.querySelector("[data-job-description]").textContent = job.description || "No overview provided.";
  document.querySelector("[data-job-responsibilities]").textContent = job.responsibilities || "• Collaborate with cross-functional teams to deliver key business outcomes.\n• Own and execute end-to-end deliverables within your domain.\n• Contribute to best practices, documentation, and continuous improvement.";
  document.querySelector("[data-job-requirements]").textContent = job.requirements || "• Relevant practical experience in the discipline.\n• Strong problem-solving and communication abilities.\n• Eligible to work in the specified location.";

  if (loadingMsg) loadingMsg.hidden = true;
  if (fullDetails) fullDetails.hidden = false;

  // Apply Job Action Trigger (Opens Modal Every Time)
  const handleApplyAction = () => {
    if (!job.is_open) return;
    openApplicationModal(job.id, job.title, job.redirect_url);
  };

  document.querySelectorAll("[data-apply-single-btn]").forEach(btn => {
    btn.disabled = !job.is_open;
    btn.innerHTML = job.is_open ? "Apply Job <span>→</span>" : "Position Closed";
    if (job.is_open) {
      btn.onclick = handleApplyAction;
    }
  });

  const saveBtn = document.querySelector("[data-save-single-btn]");
  if (saveBtn) {
    if (currentUser) {
      const { data: isSaved } = await supabaseClient.from("saved_jobs").select("id").eq("candidate_id", currentUser.id).eq("job_id", job.id).maybeSingle();
      if (isSaved) saveBtn.textContent = "Saved ♥";
    }
    saveBtn.addEventListener("click", () => toggleSaveJob(job.id, saveBtn));
  }
}

// ----------------------------------------------------
// PAGE: CANDIDATE PROFILE (profile.html)
// ----------------------------------------------------
async function loadProfilePage() {
  const user = await refreshCurrentUser();
  if (!user) {
    openAuthDialog("Sign in to access your profile");
    return;
  }

  document.querySelector("[data-profile-name]").textContent = currentProfile?.full_name || "My Dashboard";
  document.querySelector("[data-profile-email]").textContent = user.email;

  const form = document.querySelector("[data-profile-form]");
  if (form && currentProfile) {
    form.first_name.value = currentProfile.first_name || "";
    form.last_name.value = currentProfile.last_name || "";
    form.phone.value = currentProfile.phone || "";
    form.gender.value = currentProfile.gender || "";
    form.skills.value = currentProfile.skills || "";
    form.experience.value = currentProfile.experience || "";
    form.education.value = currentProfile.education || "";
    form.preferred_location.value = currentProfile.preferred_location || "";
    form.salary_expectations.value = currentProfile.salary_expectations || "";
    form.work_authorization.value = currentProfile.work_authorization || "";

    bindTagCloud(document.querySelector("[data-skill-chips]"), form.skills);
    bindTagCloud(document.querySelector("[data-industry-chips]"), form.skills);

    if (currentProfile.resume_path) {
      document.getElementById("current-cv-link").innerHTML = `
        <button type="button" class="button-text" style="font-size:12px;" onclick="viewResume('${currentProfile.resume_path}')">View current CV ↗</button>
      `;
    }
  }

  // Load Applications
  const appsContainer = document.querySelector("[data-candidate-applications]");
  const { data: apps } = await supabaseClient
    .from("applications")
    .select("id, status, created_at, jobs(id, title, department, location)")
    .eq("candidate_id", user.id)
    .order("created_at", { ascending: false });

  document.querySelector("[data-candidate-apps-count]").textContent = `(${apps?.length || 0})`;
  if (appsContainer) {
    appsContainer.innerHTML = apps && apps.length ? apps.map((a) => `
      <article class="application">
        <h3><a href="job.html?id=${a.jobs?.id}" style="color:var(--ink);">${escapeHtml(a.jobs?.title || "Role")}</a></h3>
        <p>${escapeHtml(a.jobs?.department || "")} · ${escapeHtml(a.jobs?.location || "")}</p>
        <div class="application-actions">
          <span class="status-pill status-${a.status}">${a.status}</span>
          <span style="font-size: 11px; color: var(--muted);">${new Date(a.created_at).toLocaleDateString()}</span>
        </div>
      </article>
    `).join("") : '<p class="empty-admin">You have not applied for any roles yet.</p>';
  }

  // Load Saved Roles
  const savedContainer = document.querySelector("[data-candidate-saved]");
  const { data: saved } = await supabaseClient
    .from("saved_jobs")
    .select("id, jobs(*)")
    .eq("candidate_id", user.id);

  document.querySelector("[data-candidate-saved-count]").textContent = `(${saved?.length || 0})`;
  if (savedContainer) {
    savedContainer.innerHTML = saved && saved.length ? saved.map((s) => `
      <article class="application">
        <h3><a href="job.html?id=${s.jobs?.id}" style="color:var(--ink);">${escapeHtml(s.jobs?.title)}</a></h3>
        <p>${escapeHtml(s.jobs?.department)} · ${escapeHtml(s.jobs?.location)}</p>
        <div class="application-actions">
          <a class="text-link" href="job.html?id=${s.jobs?.id}">View Details <span>→</span></a>
        </div>
      </article>
    `).join("") : '<p class="empty-admin">You have no saved roles.</p>';
  }

  form.onsubmit = async (e) => {
    e.preventDefault();
    const msg = form.querySelector(".form-message");
    showMessage(msg, "Saving changes...");

    let cvPath = currentProfile?.resume_path;
    const file = form.resume_file.files[0];
    if (file) {
      const ext = file.name.split(".").pop().toLowerCase();
      cvPath = `${user.id}/${Date.now()}.${ext}`;
      await supabaseClient.storage.from("resumes").upload(cvPath, file, { upsert: true });
    }

    const firstName = form.first_name.value.trim();
    const lastName = form.last_name.value.trim();
    const fullName = `${firstName} ${lastName}`.trim();

    const { error } = await supabaseClient.from("profiles").update({
      first_name: firstName,
      last_name: lastName,
      full_name: fullName,
      phone: form.phone.value.trim(),
      gender: form.gender.value,
      skills: form.skills.value.trim(),
      experience: form.experience.value.trim(),
      education: form.education.value.trim(),
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
      document.querySelector("[data-profile-name]").textContent = fullName || "My Dashboard";
    }
  };
}

// ----------------------------------------------------
// PAGE: ADMIN CONTROL CENTER (admin.html)
// ----------------------------------------------------
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

  // Job Modal (Create & Edit with Redirect URL)
  const jobDialog = document.querySelector("[data-job-dialog]");
  const jobForm = document.querySelector("[data-job-form]");
  document.querySelectorAll("[data-show-job-form]").forEach(btn => {
    btn.addEventListener("click", () => {
      jobForm.reset();
      jobForm.job_id.value = "";
      document.querySelector("[data-job-modal-title]").textContent = "Add a new job";
      document.querySelector("[data-job-submit-btn]").innerHTML = "Publish Job <span>→</span>";
      jobDialog.showModal();
    });
  });

  jobForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = jobForm.querySelector(".form-message");
    const jobId = jobForm.job_id.value;

    const payload = {
      title: jobForm.title.value.trim(),
      company_name: jobForm.company_name.value.trim(),
      location: jobForm.location.value.trim(),
      employment_type: jobForm.employment_type.value,
      department: jobForm.department.value.trim(),
      salary_range: jobForm.salary_range.value.trim(),
      application_deadline: jobForm.application_deadline.value.trim(),
      redirect_url: jobForm.redirect_url.value.trim(),
      description: jobForm.description.value.trim(),
      responsibilities: jobForm.responsibilities.value.trim(),
      requirements: jobForm.requirements.value.trim(),
      is_featured: jobForm.is_featured.checked,
      updated_at: new Date().toISOString()
    };

    let res = jobId
      ? await supabaseClient.from("jobs").update(payload).eq("id", jobId)
      : await supabaseClient.from("jobs").insert(payload);

    if (res.error) showMessage(msg, res.error.message, true);
    else {
      jobDialog.close();
      renderAdminDashboard();
    }
  });

  // User Modal (Create & Edit)
  const userDialog = document.querySelector("[data-user-dialog]");
  const userForm = document.querySelector("[data-user-form]");
  document.querySelectorAll("[data-show-user-form]").forEach(btn => {
    btn.addEventListener("click", () => {
      userForm.reset();
      userForm.user_id.value = "";
      document.querySelector("[data-user-modal-title]").textContent = "Create Candidate Profile";
      document.querySelector("[data-user-submit-btn]").innerHTML = "Create Candidate <span>→</span>";
      userDialog.showModal();
    });
  });

  userForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = userForm.querySelector(".form-message");
    const userId = userForm.user_id.value;

    const firstName = userForm.first_name.value.trim();
    const lastName = userForm.last_name.value.trim();
    const fullName = `${firstName} ${lastName}`.trim();

    const payload = {
      first_name: firstName,
      last_name: lastName,
      full_name: fullName,
      email: userForm.email.value.trim(),
      phone: userForm.phone.value.trim(),
      gender: userForm.gender.value,
      role: userForm.role.value,
      preferred_location: userForm.preferred_location.value.trim(),
      salary_expectations: userForm.salary_expectations.value.trim(),
      skills: userForm.skills.value.trim(),
      experience: userForm.experience.value.trim(),
      updated_at: new Date().toISOString()
    };

    let res;
    if (userId) {
      res = await supabaseClient.from("profiles").update(payload).eq("id", userId);
    } else {
      payload.id = crypto.randomUUID();
      res = await supabaseClient.from("profiles").insert(payload);
    }

    if (res.error) showMessage(msg, res.error.message, true);
    else {
      userDialog.close();
      renderAdminDashboard();
    }
  });

  checkAdmin();
}

async function renderAdminDashboard() {
  const [jobsRes, appsRes, usersRes, inquiriesRes] = await Promise.all([
    supabaseClient.from("jobs").select("*").order("created_at", { ascending: false }),
    supabaseClient.from("applications").select("*, jobs(title)").order("created_at", { ascending: false }),
    supabaseClient.from("profiles").select("*").order("created_at", { ascending: false }),
    supabaseClient.from("contact_messages").select("*").order("created_at", { ascending: false })
  ]);

  allJobsCache = jobsRes.data || [];
  allAppsCache = appsRes.data || [];
  const rawUsers = usersRes.data || [];
  const inquiries = inquiriesRes.data || [];

  allUsersCache = rawUsers.filter((u) => u.role !== "admin");

  document.querySelector("[data-job-count]").textContent = `(${allJobsCache.length})`;
  document.querySelector("[data-application-count]").textContent = `(${allAppsCache.length})`;
  document.querySelector("[data-user-count]").textContent = `(${allUsersCache.length})`;
  
  const inquiryCountEl = document.querySelector("[data-inquiry-count]");
  if (inquiryCountEl) inquiryCountEl.textContent = `(${inquiries.length})`;

  // 1. Render Jobs with core-matched buttons
  const jobsList = document.querySelector("[data-admin-jobs]");
  if (jobsList) {
    jobsList.innerHTML = allJobsCache.length ? allJobsCache.map((j) => `
      <article class="admin-job">
        <div>
          <h3><a href="job.html?id=${j.id}" target="_blank" style="color:var(--ink);">${escapeHtml(j.title)}</a> ${j.is_open ? '' : '<span class="closed-label">(Closed)</span>'} ${j.is_featured ? '<span class="featured-badge">Featured</span>' : ''}</h3>
          <p>${escapeHtml(j.department)} · ${escapeHtml(j.location)} · ${escapeHtml(j.employment_type)} ${j.salary_range ? `· ${escapeHtml(j.salary_range)}` : ''}</p>
          ${j.redirect_url ? `<p style="font-size:11px; color:var(--peach); margin-top:2px;">Redirect URL: <a href="${escapeHtml(j.redirect_url)}" target="_blank" style="text-decoration:underline;">${escapeHtml(j.redirect_url)}</a></p>` : ''}
        </div>
        <div class="admin-item-actions">
          <a class="btn-ctrl" href="job.html?id=${j.id}" target="_blank">View Live ↗</a>
          <button class="btn-ctrl btn-ctrl-primary" onclick="editJob('${j.id}')">Edit</button>
          <button class="btn-ctrl" onclick="toggleJobStatus('${j.id}', ${j.is_open})">${j.is_open ? 'Close' : 'Reopen'}</button>
          <button class="btn-ctrl btn-ctrl-delete" onclick="deleteJob('${j.id}')">Delete</button>
        </div>
      </article>
    `).join("") : '<p class="empty-admin">No jobs posted yet.</p>';
  }

  // 2. Render Applications with core-matched buttons
  const appsList = document.querySelector("[data-applications]");
  if (appsList) {
    appsList.innerHTML = allAppsCache.length ? allAppsCache.map((a) => `
      <article class="application">
        <h3>${escapeHtml(a.full_name)} — <span style="font-weight: 400; color: var(--muted);">${escapeHtml(a.jobs?.title || "Role")}</span></h3>
        <p>Email: ${escapeHtml(a.email)} | Phone: ${escapeHtml(a.phone)} · Applied: ${new Date(a.created_at).toLocaleDateString()}</p>
        <div class="application-actions">
          <div style="display:flex; gap:8px; align-items:center;">
            <button type="button" class="btn-ctrl btn-ctrl-primary" onclick="viewApplicationModal('${a.id}')">View Details</button>
            ${a.resume_path ? `<button type="button" class="btn-ctrl" onclick="viewResume('${a.resume_path}')">Download CV</button>` : ''}
          </div>
          <div style="display:flex; gap:10px; align-items:center;">
            <label>Status:
              <select onchange="updateApplicationStatus('${a.id}', this.value)">
                <option value="received" ${a.status === 'received' ? 'selected' : ''}>Received</option>
                <option value="shortlisted" ${a.status === 'shortlisted' ? 'selected' : ''}>Shortlisted</option>
                <option value="interview" ${a.status === 'interview' ? 'selected' : ''}>Interview</option>
                <option value="hired" ${a.status === 'hired' ? 'selected' : ''}>Hired</option>
                <option value="rejected" ${a.status === 'rejected' ? 'selected' : ''}>Rejected</option>
              </select>
            </label>
            <button class="btn-ctrl btn-ctrl-delete" onclick="deleteApplication('${a.id}')">Delete</button>
          </div>
        </div>
      </article>
    `).join("") : '<p class="empty-admin">No applications received yet.</p>';
  }

  // 3. Render Users (Candidates Only) with core-matched buttons
  const usersList = document.querySelector("[data-admin-users]");
  if (usersList) {
    usersList.innerHTML = allUsersCache.length ? allUsersCache.map((u) => `
      <article class="admin-job">
        <div>
          <h3>${escapeHtml(u.full_name || u.email)} ${u.is_blocked ? '<span style="color:red; font-size:11px; font-weight:700;">[BLOCKED]</span>' : ''}</h3>
          <p>${escapeHtml(u.email)} | Phone: ${escapeHtml(u.phone || 'N/A')} | Gender: ${escapeHtml(u.gender || 'N/A')}</p>
          <p style="font-size:12px; color:var(--muted); margin-top:2px;">Skills: ${escapeHtml(u.skills || 'None listed')} | Location: ${escapeHtml(u.preferred_location || 'Not set')}</p>
        </div>
        <div class="admin-item-actions">
          <button class="btn-ctrl btn-ctrl-primary" onclick="editUser('${u.id}')">Edit</button>
          <button class="btn-ctrl" onclick="toggleUserBlock('${u.id}', ${u.is_blocked})">${u.is_blocked ? 'Unblock' : 'Block'}</button>
          <button class="btn-ctrl btn-ctrl-delete" onclick="deleteUser('${u.id}')">Delete</button>
        </div>
      </article>
    `).join("") : '<p class="empty-admin">No registered candidate users found.</p>';
  }

  // 4. Render Contact Inquiries with core-matched buttons
  const inquiriesList = document.querySelector("[data-admin-inquiries]");
  if (inquiriesList) {
    inquiriesList.innerHTML = inquiries.length ? inquiries.map((m) => `
      <article class="application">
        <h3>${escapeHtml(m.name)} — <span style="font-weight: 400; color: var(--peach);">${escapeHtml(m.interest)}</span></h3>
        <p>Email: <a href="mailto:${escapeHtml(m.email)}" style="font-weight:600; color:var(--ink);">${escapeHtml(m.email)}</a> · ${new Date(m.created_at).toLocaleDateString()}</p>
        <p style="margin-top:6px; color:var(--ink); font-size:13px; background:var(--cream); padding:10px; border-left:3px solid var(--peach);">${escapeHtml(m.message)}</p>
        <div class="application-actions" style="justify-content: flex-end;">
          <button class="btn-ctrl btn-ctrl-delete" onclick="deleteInquiry('${m.id}')">Delete Message</button>
        </div>
      </article>
    `).join("") : '<p class="empty-admin">No contact messages received yet.</p>';
  }
}

// Global CRUD Helpers
window.editJob = (id) => {
  const job = allJobsCache.find((j) => j.id === id);
  if (!job) return;
  const dialog = document.querySelector("[data-job-dialog]");
  const form = document.querySelector("[data-job-form]");
  
  form.job_id.value = job.id;
  form.title.value = job.title || "";
  form.company_name.value = job.company_name || "";
  form.department.value = job.department || "";
  form.employment_type.value = job.employment_type || "Full-time";
  form.location.value = job.location || "";
  form.salary_range.value = job.salary_range || "";
  form.application_deadline.value = job.application_deadline || "";
  form.redirect_url.value = job.redirect_url || "";
  form.description.value = job.description || "";
  form.responsibilities.value = job.responsibilities || "";
  form.requirements.value = job.requirements || "";
  form.is_featured.checked = Boolean(job.is_featured);

  document.querySelector("[data-job-modal-title]").textContent = "Edit Job Specification";
  document.querySelector("[data-job-submit-btn]").innerHTML = "Update Job <span>→</span>";
  dialog.showModal();
};

window.deleteJob = async (id) => {
  if (confirm("Permanently delete this job listing?")) {
    await supabaseClient.from("jobs").delete().eq("id", id);
    renderAdminDashboard();
  }
};

window.toggleJobStatus = async (id, isOpen) => {
  await supabaseClient.from("jobs").update({ is_open: !isOpen }).eq("id", id);
  renderAdminDashboard();
};

window.editUser = (id) => {
  const user = allUsersCache.find((u) => u.id === id);
  if (!user) return;
  const dialog = document.querySelector("[data-user-dialog]");
  const form = document.querySelector("[data-user-form]");

  form.user_id.value = user.id;
  form.first_name.value = user.first_name || "";
  form.last_name.value = user.last_name || "";
  form.email.value = user.email || "";
  form.phone.value = user.phone || "";
  form.gender.value = user.gender || "";
  form.role.value = user.role || "candidate";
  form.preferred_location.value = user.preferred_location || "";
  form.salary_expectations.value = user.salary_expectations || "";
  form.skills.value = user.skills || "";
  form.experience.value = user.experience || "";

  document.querySelector("[data-user-modal-title]").textContent = "Edit Candidate Profile";
  document.querySelector("[data-user-submit-btn]").innerHTML = "Update Candidate <span>→</span>";
  dialog.showModal();
};

window.deleteUser = async (id) => {
  if (confirm("Delete this candidate profile? This cannot be undone.")) {
    await supabaseClient.from("profiles").delete().eq("id", id);
    renderAdminDashboard();
  }
};

window.toggleUserBlock = async (id, isBlocked) => {
  await supabaseClient.from("profiles").update({ is_blocked: !isBlocked }).eq("id", id);
  renderAdminDashboard();
};

window.viewApplicationModal = (appId) => {
  const app = allAppsCache.find((a) => a.id === appId);
  if (!app) return;
  const dialog = document.querySelector("[data-app-detail-dialog]");
  
  document.querySelector("[data-view-app-candidate]").textContent = app.full_name || "Applicant";
  document.querySelector("[data-view-app-job]").textContent = app.jobs?.title || "Role Application";
  document.querySelector("[data-view-app-email]").textContent = app.email || "N/A";
  document.querySelector("[data-view-app-phone]").textContent = app.phone || "N/A";
  document.querySelector("[data-view-app-date]").textContent = new Date(app.created_at).toLocaleString();
  document.querySelector("[data-view-app-note]").textContent = app.message || "No cover note provided.";

  const cvBtn = document.querySelector("[data-view-app-cv-btn]");
  if (app.resume_path) {
    cvBtn.hidden = false;
    cvBtn.onclick = () => viewResume(app.resume_path);
  } else {
    cvBtn.hidden = true;
  }

  dialog.showModal();
};

window.updateApplicationStatus = async (id, status) => {
  await supabaseClient.from("applications").update({ status }).eq("id", id);
};

window.deleteApplication = async (id) => {
  if (confirm("Delete this application record?")) {
    await supabaseClient.from("applications").delete().eq("id", id);
    renderAdminDashboard();
  }
};

window.deleteInquiry = async (id) => {
  if (confirm("Delete this contact message?")) {
    await supabaseClient.from("contact_messages").delete().eq("id", id);
    renderAdminDashboard();
  }
};

window.viewResume = async (path) => {
  const { data } = await supabaseClient.storage.from("resumes").createSignedUrl(path, 60);
  if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  else alert("Resume file could not be opened.");
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
  setupContactForm();

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
  else if (page === "single-job") initSingleJobPage();
  else if (page === "profile") loadProfilePage();
  else if (page === "admin") initAdminPage();
});
