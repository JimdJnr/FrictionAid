(function () {
  "use strict";

  const CATEGORIES = [
    { name: "Searching for equipment", icon: "🔍" },
    { name: "Broken / faulty equipment", icon: "🛠️" },
    { name: "Missing linen / laundry", icon: "🛏️" },
    { name: "No beds / clinical space", icon: "🚪" },
    { name: "IT & computer problems", icon: "💻" },
    { name: "Can't reach the right staff", icon: "👥" },
    { name: "Waiting for porters / transport", icon: "🛒" },
    { name: "Supplies / stock shortages", icon: "📦" },
    { name: "Medication / pharmacy delays", icon: "💊" },
    { name: "Cleaning / environment", icon: "🧹" },
    { name: "Phone / communication issues", icon: "☎️" },
    { name: "Admin / paperwork / handovers", icon: "📋" },
    { name: "Other", icon: "➕" },
  ];

  // Keyword hints for auto-selecting a category from the description.
  // Order matters only as a tie-breaker (earlier wins on equal score).
  const CATEGORY_KEYWORDS = [
    {
      name: "Waiting for porters / transport",
      words: ["porter", "porters", "transport", "patient transport", "escort", "wheelchair escort", "ambulance transfer", "move the patient", "take the patient"],
    },
    {
      name: "Medication / pharmacy delays",
      words: ["medication", "meds", "drug", "drugs", "pharmacy", "pharmacist", "prescription", "prescribe", "prescribed", "tto", "to take out", "controlled drug", "cd cupboard", "antibiotic", "antibiotics", "analgesia", "painkiller", "painkillers", "insulin", "dose", "doses"],
    },
    {
      name: "Missing linen / laundry",
      words: ["pillow", "pillowcase", "pillowcases", "linen", "laundry", "sheet", "sheets", "bedding", "blanket", "blankets", "towel", "towels", "gown", "gowns", "duvet", "scrubs"],
    },
    {
      name: "IT & computer problems",
      words: ["computer", "pc", "laptop", "system", "systems", "login", "log in", "logon", "password", "terminal", "screen", "software", "network", "wifi", "wi-fi", "internet", "slow", "freeze", "frozen", "crash", "crashed", "epr", "printer", "printing", "loading", "smartcard"],
    },
    {
      name: "Broken / faulty equipment",
      words: ["broken", "faulty", "not working", "doesn't work", "does not work", "won't turn on", "wont turn on", "out of order", "malfunction", "stopped working", "needs repair", "fault", "damaged"],
    },
    {
      name: "Searching for equipment",
      words: ["equipment", "machine", "device", "pump", "monitor", "wheelchair", "hoist", "commode", "drip stand", "trolley", "defib", "ecg", "bp machine", "thermometer", "sats probe", "can't find a", "cannot find a", "looking for a", "searching for", "no equipment"],
    },
    {
      name: "Can't reach the right staff",
      words: ["staff", "nurse", "doctor", "consultant", "registrar", "sho", "bleep", "colleague", "on call", "on-call", "can't find anyone", "cannot find anyone", "find someone", "locate a", "no one available", "short staffed", "short-staffed", "understaffed"],
    },
    {
      name: "Supplies / stock shortages",
      words: ["supply", "supplies", "stock", "gloves", "aprons", "syringe", "syringes", "cannula", "cannulas", "dressing", "dressings", "swabs", "consumable", "consumables", "run out", "ran out", "out of", "order more", "obtain", "empty", "restock"],
    },
    {
      name: "No beds / clinical space",
      words: ["space", "room", "rooms", "bay", "bed", "beds", "cubicle", "side room", "clinical space", "no room", "no space", "no beds", "nowhere to", "capacity", "overcrowded"],
    },
    {
      name: "Cleaning / environment",
      words: ["clean", "cleaning", "cleaner", "dirty", "spillage", "spill", "mess", "hygiene", "bin", "bins", "waste", "rubbish", "toilet", "smell", "too hot", "too cold", "broken light", "leak", "flood"],
    },
    {
      name: "Phone / communication issues",
      words: ["phone", "telephone", "extension", "no answer", "line busy", "can't get through", "cannot get through", "switchboard", "signal", "handset", "voicemail"],
    },
    {
      name: "Admin / paperwork / handovers",
      words: ["hand-off", "handoff", "hand off", "handover", "admin", "paperwork", "form", "forms", "referral", "sign off", "sign-off", "discharge letter", "discharge summary", "documentation", "chase up", "passed between", "notes missing", "chart"],
    },
  ];

  // --- Element refs ---
  const categoryGrid = document.getElementById("categoryGrid");
  const descriptionEl = document.getElementById("description");
  const locationEl = document.getElementById("location");
  const reporterEl = document.getElementById("reporter");
  const priorityGroup = document.getElementById("priorityGroup");
  const submitBtn = document.getElementById("submitBtn");
  const formMsg = document.getElementById("formMsg");
  const voiceBtn = document.getElementById("voiceBtn");
  const voiceLabel = document.getElementById("voiceLabel");
  const voiceStatus = document.getElementById("voiceStatus");
  const unsupportedEl = document.getElementById("unsupported");
  const tabs = document.querySelectorAll(".tab");
  const reportView = document.getElementById("reportView");
  const listView = document.getElementById("listView");
  const allView = document.getElementById("allView");
  const resolvedView = document.getElementById("resolvedView");

  // Recent reports view
  const reportListEl = document.getElementById("reportList");
  const statusFilter = document.getElementById("statusFilter");
  const refreshBtn = document.getElementById("refreshBtn");

  // All reports view
  const allListEl = document.getElementById("allList");
  const allCategoryFilter = document.getElementById("allCategoryFilter");
  const allPriorityFilter = document.getElementById("allPriorityFilter");
  const allStatusFilter = document.getElementById("allStatusFilter");
  const clearFiltersBtn = document.getElementById("clearFiltersBtn");
  const allCountEl = document.getElementById("allCount");

  // Resolved reports view
  const resolvedListEl = document.getElementById("resolvedList");
  const resolvedRefreshBtn = document.getElementById("resolvedRefreshBtn");

  // Emergency notification banner
  const emergencyBanner = document.getElementById("emergencyBanner");
  const emergencyText = document.getElementById("emergencyText");
  const emergencyDismiss = document.getElementById("emergencyDismiss");

  let selectedCategory = null;
  let manualCategory = false;
  let selectedPriority = "Medium";
  let activeView = "report";

  // --- Build category chips ---
  CATEGORIES.forEach(function (cat) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "category-chip";
    btn.dataset.category = cat.name;
    btn.innerHTML =
      '<span class="chip-icon" aria-hidden="true">' + cat.icon + "</span>" +
      "<span>" + cat.name + "</span>";
    btn.addEventListener("click", function () {
      applyCategory(cat.name, true);
      if (formMsg.classList.contains("error")) setFormMsg("", "");
    });
    categoryGrid.appendChild(btn);
  });

  // Populate the "All reports" category filter.
  CATEGORIES.forEach(function (cat) {
    const opt = document.createElement("option");
    opt.value = cat.name;
    opt.textContent = cat.name;
    allCategoryFilter.appendChild(opt);
  });

  function highlightCategory(name) {
    document.querySelectorAll(".category-chip").forEach(function (c) {
      c.classList.toggle("active", c.dataset.category === name);
    });
  }

  function applyCategory(name, manual) {
    selectedCategory = name;
    if (manual) manualCategory = true;
    highlightCategory(name);
  }

  // Guess a category from free text; returns a name or null.
  function autoCategorize(text) {
    const t = " " + text.toLowerCase() + " ";
    let best = null;
    let bestScore = 0;
    CATEGORY_KEYWORDS.forEach(function (entry) {
      let score = 0;
      entry.words.forEach(function (w) {
        if (t.indexOf(w) !== -1) score++;
      });
      if (score > bestScore) {
        bestScore = score;
        best = entry.name;
      }
    });
    return bestScore > 0 ? best : null;
  }

  // Re-evaluate category suggestion from the current description text.
  function maybeAutoCategorize() {
    if (manualCategory) return;
    // Update the suggested category as the description changes. If the person has
    // written something but no specific type matches, fall back to "Other" so the
    // full description is captured there rather than left uncategorised.
    let guess = autoCategorize(descriptionEl.value);
    if (!guess && descriptionEl.value.trim()) guess = "Other";
    selectedCategory = guess;
    highlightCategory(guess);
  }

  // --- Priority selection ---
  // Choosing "Emergency" is guarded: the first click arms it ("Click again to
  // confirm"), and only a second click actually selects it. Picking any other
  // priority (or a timeout) cancels the pending confirmation.
  const emergencyPriorityBtn = priorityGroup.querySelector('[data-priority="Emergency"]');
  const EMERGENCY_LABEL = emergencyPriorityBtn ? emergencyPriorityBtn.innerHTML : "";
  let emergencyArmed = false;
  let emergencyArmTimer = null;

  function disarmEmergencyPriority() {
    emergencyArmed = false;
    if (emergencyArmTimer) {
      clearTimeout(emergencyArmTimer);
      emergencyArmTimer = null;
    }
    if (emergencyPriorityBtn) {
      emergencyPriorityBtn.classList.remove("confirming");
      emergencyPriorityBtn.innerHTML = EMERGENCY_LABEL;
    }
  }

  priorityGroup.addEventListener("click", function (e) {
    const btn = e.target.closest(".priority-btn");
    if (!btn) return;

    if (btn.dataset.priority === "Emergency") {
      if (selectedPriority === "Emergency") return; // already selected
      if (!emergencyArmed) {
        emergencyArmed = true;
        btn.classList.add("confirming");
        btn.textContent = "Click again to confirm";
        emergencyArmTimer = setTimeout(disarmEmergencyPriority, 4000);
        return;
      }
      disarmEmergencyPriority(); // second click — restore label, then select
    } else {
      disarmEmergencyPriority(); // a different priority cancels the confirm
    }

    selectedPriority = btn.dataset.priority;
    priorityGroup.querySelectorAll(".priority-btn").forEach(function (b) {
      b.classList.toggle("active", b === btn);
    });
  });

  descriptionEl.addEventListener("input", maybeAutoCategorize);

  function setFormMsg(text, type) {
    formMsg.textContent = text;
    formMsg.className = "form-msg" + (type ? " " + type : "");
  }

  // --- Tab switching ---
  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      tabs.forEach(function (t) { t.classList.remove("active"); });
      tab.classList.add("active");
      const view = tab.dataset.view;
      activeView = view;
      reportView.classList.toggle("hidden", view !== "report");
      listView.classList.toggle("hidden", view !== "list");
      allView.classList.toggle("hidden", view !== "all");
      resolvedView.classList.toggle("hidden", view !== "resolved");
      if (view === "list") loadRecentReports();
      if (view === "all") loadAllReports();
      if (view === "resolved") loadResolvedReports();
    });
  });

  // Reload whichever list is currently visible (used after live updates).
  function reloadActiveView() {
    if (activeView === "list") loadRecentReports();
    else if (activeView === "all") loadAllReports();
    else if (activeView === "resolved") loadResolvedReports();
  }

  // --- Submit report ---
  submitBtn.addEventListener("click", function () {
    const description = descriptionEl.value.trim();
    if (!description) {
      setFormMsg("Please describe the issue (speak or type).", "error");
      descriptionEl.focus();
      return;
    }
    // Last-chance category: match keywords, else capture under "Other" so the
    // full typed/spoken description is still recorded rather than blocking submit.
    if (!selectedCategory) {
      applyCategory(autoCategorize(description) || "Other", false);
    }

    submitBtn.disabled = true;
    setFormMsg("Sending...", "");

    fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: selectedCategory,
        description: description,
        location: locationEl.value.trim(),
        reporter: reporterEl.value.trim(),
        priority: selectedPriority,
      }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (r) {
        if (!r.ok) throw new Error(r.data.error || "Could not save report.");
        setFormMsg("Report submitted. Thank you!", "ok");
        resetForm();
      })
      .catch(function (err) {
        setFormMsg(err.message, "error");
      })
      .finally(function () {
        submitBtn.disabled = false;
      });
  });

  function resetForm() {
    descriptionEl.value = "";
    locationEl.value = "";
    reporterEl.value = "";
    selectedCategory = null;
    manualCategory = false;
    highlightCategory(null);
    disarmEmergencyPriority();
    selectedPriority = "Medium";
    priorityGroup.querySelectorAll(".priority-btn").forEach(function (b) {
      b.classList.toggle("active", b.dataset.priority === "Medium");
    });
  }

  // Turn a button into a two-step "click again to confirm" control. The first
  // click swaps in `armedLabel` and arms it; a second click within 4s runs
  // `onConfirm`. Used to guard emergency-related actions against misclicks.
  function armConfirm(btn, armedLabel, onConfirm) {
    const originalLabel = btn.textContent;
    let armed = false;
    let timer = null;
    function disarm() {
      armed = false;
      btn.classList.remove("confirming");
      btn.textContent = originalLabel;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }
    btn.addEventListener("click", function () {
      if (!armed) {
        armed = true;
        btn.classList.add("confirming");
        btn.textContent = armedLabel;
        timer = setTimeout(disarm, 4000);
        return;
      }
      disarm();
      onConfirm();
    });
  }

  // Show an inline confirm strip before resolving an emergency report (the
  // status dropdown can't self-confirm, so the change is held until confirmed).
  function showResolveConfirm(actions, report, reloadFn) {
    const existing = actions.querySelector(".confirm-bar");
    if (existing) existing.remove();

    const bar = document.createElement("div");
    bar.className = "confirm-bar";

    const label = document.createElement("span");
    label.className = "confirm-label";
    label.textContent = "🚨 Resolve this emergency?";

    const yes = document.createElement("button");
    yes.type = "button";
    yes.className = "confirm-yes";
    yes.textContent = "Confirm resolve";

    const no = document.createElement("button");
    no.type = "button";
    no.className = "confirm-no";
    no.textContent = "Cancel";

    const timer = setTimeout(function () { bar.remove(); }, 6000);
    yes.addEventListener("click", function () {
      clearTimeout(timer);
      bar.remove();
      patchReport(report.id, { status: "Resolved" }, reloadFn);
    });
    no.addEventListener("click", function () {
      clearTimeout(timer);
      bar.remove();
    });

    bar.appendChild(label);
    bar.appendChild(yes);
    bar.appendChild(no);
    actions.appendChild(bar);
  }

  // --- Shared rendering ---
  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatTime(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  }

  function renderReports(reports, container, reloadFn, opts) {
    if (!reports || reports.length === 0) {
      container.innerHTML = '<p class="empty">No reports match.</p>';
      return;
    }
    container.innerHTML = "";
    const resolvedView = opts && opts.resolvedView;
    reports.forEach(function (r) {
      const isEmergency = r.priority === "Emergency";
      const item = document.createElement("div");
      item.className = "report-item p-" + r.priority;

      const meta = [];
      if (r.location) meta.push("<strong>" + escapeHtml(r.location) + "</strong>");
      if (r.reporter) meta.push("by " + escapeHtml(r.reporter));
      meta.push(formatTime(r.created_at));
      meta.push(escapeHtml(r.priority) + " priority");
      if (resolvedView && r.resolved_at) {
        meta.push("resolved " + formatTime(r.resolved_at));
      }

      const statusClass = r.status === "In progress" ? "In-progress" : r.status;
      const flag = isEmergency
        ? '<span class="emergency-flag">🚨 Emergency</span>'
        : "";

      item.innerHTML =
        '<div class="report-top">' +
          '<span class="report-cat">' + escapeHtml(r.category) + flag + "</span>" +
          '<span class="badge ' + statusClass + '">' + escapeHtml(r.status) + "</span>" +
        "</div>" +
        '<p class="report-desc">' + escapeHtml(r.description) + "</p>" +
        '<div class="report-meta">' + meta.join(" • ") + "</div>";

      const actions = document.createElement("div");
      actions.className = "report-actions";

      if (resolvedView) {
        // In the resolved section, offer to re-open (unresolve) the report.
        // Reviving an emergency needs a confirming second click.
        const unBtn = document.createElement("button");
        unBtn.type = "button";
        unBtn.className = "unresolve-btn";
        unBtn.textContent = "↩ Unresolve";
        if (isEmergency) {
          armConfirm(unBtn, "Click again to revive 🚨", function () {
            patchReport(r.id, { status: "Open" }, reloadFn);
          });
        } else {
          unBtn.addEventListener("click", function () {
            patchReport(r.id, { status: "Open" }, reloadFn);
          });
        }
        actions.appendChild(unBtn);
      } else {
        const select = document.createElement("select");
        select.className = "status-select";
        ["Open", "In progress", "Resolved"].forEach(function (s) {
          const opt = document.createElement("option");
          opt.value = s;
          opt.textContent = "Mark: " + s;
          if (s === r.status) opt.selected = true;
          select.appendChild(opt);
        });
        select.addEventListener("change", function () {
          // Resolving an emergency is held until an explicit confirm click.
          if (isEmergency && select.value === "Resolved") {
            select.value = r.status; // revert until confirmed
            showResolveConfirm(actions, r, reloadFn);
            return;
          }
          patchReport(r.id, { status: select.value }, reloadFn);
        });
        actions.appendChild(select);

        if (!isEmergency) {
          const emBtn = document.createElement("button");
          emBtn.type = "button";
          emBtn.className = "emergency-btn";
          emBtn.textContent = "🚨 Mark emergency";
          armConfirm(emBtn, "Click again to confirm 🚨", function () {
            emBtn.disabled = true;
            patchReport(r.id, { priority: "Emergency" }, reloadFn);
          });
          actions.appendChild(emBtn);
        }
      }

      item.appendChild(actions);
      container.appendChild(item);
    });
  }

  // Patch a report (status and/or priority) and reload the active list.
  function patchReport(id, changes, reloadFn) {
    fetch("/api/reports/" + id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changes),
    })
      .then(function (res) {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then(function () {
        if (reloadFn) reloadFn();
      })
      .catch(function () {
        if (reloadFn) reloadFn();
      });
  }

  // --- Recent reports (newest first) ---
  function loadRecentReports() {
    reportListEl.innerHTML = '<p class="empty">Loading...</p>';
    const status = statusFilter.value;
    const url = "/api/reports" + (status ? "?status=" + encodeURIComponent(status) : "");
    fetch(url)
      .then(function (res) { return res.json(); })
      .then(function (reports) {
        renderReports(reports, reportListEl, loadRecentReports);
      })
      .catch(function () {
        reportListEl.innerHTML =
          '<p class="empty">Could not load reports. Try refreshing.</p>';
      });
  }

  statusFilter.addEventListener("change", loadRecentReports);
  refreshBtn.addEventListener("click", loadRecentReports);

  // --- All reports (sorted by urgency, with filters) ---
  function loadAllReports() {
    allListEl.innerHTML = '<p class="empty">Loading...</p>';
    allCountEl.textContent = "";
    const params = ["sort=urgency"];
    if (allCategoryFilter.value)
      params.push("category=" + encodeURIComponent(allCategoryFilter.value));
    if (allPriorityFilter.value)
      params.push("priority=" + encodeURIComponent(allPriorityFilter.value));
    if (allStatusFilter.value)
      params.push("status=" + encodeURIComponent(allStatusFilter.value));

    fetch("/api/reports?" + params.join("&"))
      .then(function (res) { return res.json(); })
      .then(function (reports) {
        renderReports(reports, allListEl, loadAllReports);
        const n = reports ? reports.length : 0;
        allCountEl.textContent = n + (n === 1 ? " report" : " reports");
      })
      .catch(function () {
        allListEl.innerHTML =
          '<p class="empty">Could not load reports. Try again.</p>';
      });
  }

  // --- Resolved reports (moved here 2 min after being resolved) ---
  function loadResolvedReports() {
    resolvedListEl.innerHTML = '<p class="empty">Loading...</p>';
    fetch("/api/reports?bucket=resolved")
      .then(function (res) { return res.json(); })
      .then(function (reports) {
        renderReports(reports, resolvedListEl, loadResolvedReports, { resolvedView: true });
      })
      .catch(function () {
        resolvedListEl.innerHTML =
          '<p class="empty">Could not load resolved reports. Try again.</p>';
      });
  }

  resolvedRefreshBtn.addEventListener("click", loadResolvedReports);

  allCategoryFilter.addEventListener("change", loadAllReports);
  allPriorityFilter.addEventListener("change", loadAllReports);
  allStatusFilter.addEventListener("change", loadAllReports);
  clearFiltersBtn.addEventListener("click", function () {
    allCategoryFilter.value = "";
    allPriorityFilter.value = "";
    allStatusFilter.value = "";
    loadAllReports();
  });

  // ============ Voice input (Web Speech API) ============
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  let recognition = null;
  let listening = false;
  let starting = false;
  let baseText = "";

  function setVoiceStatus(msg, type) {
    voiceStatus.textContent = msg;
    voiceStatus.className = "voice-status" + (type ? " " + type : "");
  }

  if (!SpeechRecognition) {
    voiceBtn.disabled = true;
    voiceLabel.textContent = "Voice N/A";
    unsupportedEl.classList.remove("hidden");
    setVoiceStatus("Voice input isn't supported here — please type your report.", "");
  } else {
    voiceBtn.addEventListener("click", function () {
      if (listening) stopVoice();
      else startVoice();
    });
  }

  function resetVoiceButton() {
    voiceBtn.classList.remove("listening");
    voiceLabel.textContent = "Speak";
  }

  function createRecognition() {
    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-GB";

    rec.onstart = function () {
      starting = false;
      listening = true;
      voiceBtn.classList.add("listening");
      voiceLabel.textContent = "Stop";
      setVoiceStatus("Listening... speak now.", "active");
    };
    rec.onaudiostart = function () {
      setVoiceStatus("Microphone active — speak now.", "active");
    };
    rec.onspeechstart = function () {
      setVoiceStatus("Hearing you...", "active");
    };

    rec.onresult = function (event) {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          baseText += result[0].transcript.trim() + " ";
        } else {
          interim += result[0].transcript;
        }
      }
      descriptionEl.value = (baseText + interim).replace(/\s+/g, " ").trimStart();
      maybeAutoCategorize();
    };

    rec.onerror = function (event) {
      if (event.error === "no-speech") {
        setVoiceStatus("Didn't catch that — keep talking.", "active");
        return;
      }
      if (event.error === "aborted") return;

      starting = false;
      listening = false;
      resetVoiceButton();

      if (event.error === "not-allowed") {
        setVoiceStatus(
          "Microphone blocked. Click the mic/lock icon in the address bar and allow it.",
          "error"
        );
      } else if (event.error === "service-not-allowed") {
        setVoiceStatus(
          "On Windows, turn ON Settings > Privacy > Speech > 'Online speech recognition'.",
          "error"
        );
      } else if (event.error === "audio-capture") {
        setVoiceStatus("No microphone found. Check your input device.", "error");
      } else if (event.error === "network") {
        setVoiceStatus("Network error — voice needs an internet connection.", "error");
      } else {
        setVoiceStatus("Voice error: " + event.error + ". You can type instead.", "error");
      }
    };

    rec.onend = function () {
      starting = false;
      if (listening) {
        try {
          starting = true;
          rec.start();
        } catch (e) {
          starting = false;
          listening = false;
          resetVoiceButton();
        }
      } else {
        resetVoiceButton();
      }
    };

    return rec;
  }

  function startVoice() {
    if (starting || listening) return;
    starting = true;
    baseText = descriptionEl.value ? descriptionEl.value.trim() + " " : "";
    recognition = createRecognition();
    try {
      recognition.start();
    } catch (e) {
      starting = false;
      setVoiceStatus("Could not start voice: " + e.message, "error");
    }
  }

  function stopVoice() {
    listening = false;
    starting = false;
    if (recognition) recognition.stop();
    resetVoiceButton();
    setVoiceStatus("Stopped. Review your text, then submit.", "");
  }

  // ============ Emergency notifications (Server-Sent Events) ============
  let bannerTimer = null;

  function playAlertTone() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const now = ctx.currentTime;
      [880, 1175].forEach(function (freq, i) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        const start = now + i * 0.28;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.25);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.27);
      });
      setTimeout(function () { ctx.close(); }, 900);
    } catch (e) {
      /* audio is a nice-to-have; ignore failures */
    }
  }

  function showEmergency(report) {
    const where = report.location ? " at " + report.location : "";
    const who = report.reporter ? " (reported by " + report.reporter + ")" : "";
    emergencyText.textContent =
      "EMERGENCY: " + report.category + where + " — " + report.description + who;
    emergencyBanner.classList.remove("hidden");
    playAlertTone();
    if (bannerTimer) clearTimeout(bannerTimer);
    bannerTimer = setTimeout(function () {
      emergencyBanner.classList.add("hidden");
    }, 20000);
    // Surface the new emergency in whatever list is open.
    reloadActiveView();
  }

  emergencyDismiss.addEventListener("click", function () {
    emergencyBanner.classList.add("hidden");
    if (bannerTimer) clearTimeout(bannerTimer);
  });

  function connectEvents() {
    if (!window.EventSource) return;
    const source = new EventSource("/api/events");
    source.onmessage = function (e) {
      if (!e.data) return;
      try {
        const event = JSON.parse(e.data);
        if (event.type === "emergency" && event.report) {
          showEmergency(event.report);
        }
      } catch (err) {
        /* ignore malformed events */
      }
    };
    // EventSource auto-reconnects on error; no extra handling needed.
  }

  connectEvents();
})();
