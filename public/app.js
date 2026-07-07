(function () {
  "use strict";

  // Inline SVG icon set (Feather/Lucide-style strokes). Each entry holds the
  // inner markup; svgIcon() wraps it in a consistent <svg>. stroke=currentColor
  // so icons inherit the surrounding text colour.
  const ICONS = {
    search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    bed: '<path d="M3 18V6"/><path d="M3 12h15a3 3 0 0 1 3 3v3"/><path d="M3 18h18"/><circle cx="8" cy="9.5" r="1.5"/>',
    door: '<path d="M4 21V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v17"/><path d="M2 21h18"/><path d="M13.5 12h.01"/>',
    monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    truck: '<rect x="1" y="3" width="15" height="13"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
    box: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
    pill: '<path d="M10.5 20.5 3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7Z"/><line x1="8.5" y1="8.5" x2="15.5" y2="15.5"/>',
    sparkle: '<path d="M5 3v4"/><path d="M3 5h4"/><path d="M12 8l1.8 4.2L18 14l-4.2 1.8L12 20l-1.8-4.2L6 14l4.2-1.8z"/>',
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
    clipboard: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>',
    plusCircle: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>',
    alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    note: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    mic: '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',
    undo: '<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    mask: '<path d="M20 5H4a2 2 0 0 0-2 2v4a8 8 0 0 0 8 8h4a8 8 0 0 0 8-8V7a2 2 0 0 0-2-2z"/><path d="M7 11h.01"/><path d="M17 11h.01"/><path d="M9 15c1 1 5 1 6 0"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    // Sentiment faces — consistent circle + eyes with distinct mouths/brows.
    frustrated: '<circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><path d="M7.5 8.5l2 1"/><path d="M16.5 8.5l-2 1"/>',
    embarrassed: '<circle cx="12" cy="12" r="10"/><path d="M8 15.5c1-.8 2-.8 3 0s2 .8 3 0"/><path d="M9 10h.01"/><path d="M15 10h.01"/>',
    resentful: '<circle cx="12" cy="12" r="10"/><line x1="8.5" y1="15.5" x2="15.5" y2="14.5"/><path d="M8 10.5l2-.5"/><path d="M16 10.5l-2-.5"/>',
    undervalued: '<circle cx="12" cy="12" r="10"/><path d="M15 16s-1-1.3-3-1.3-3 1.3-3 1.3"/><path d="M9 10h.01"/><path d="M15 10h.01"/>',
    helpless: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="16" r="1.5"/><path d="M8 9.5l2-1"/><path d="M16 9.5l-2-1"/>',
    cynical: '<circle cx="12" cy="12" r="10"/><path d="M8 16c2 0 4-.6 6-1.8"/><path d="M9 9.5h.01"/><path d="M15 9.5h.01"/>',
  };

  function svgIcon(name) {
    const inner = ICONS[name];
    if (!inner) return "";
    return (
      '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true" focusable="false">' + inner + "</svg>"
    );
  }

  const CATEGORIES = [
    { name: "Searching for equipment", icon: "search" },
    { name: "Broken / faulty equipment", icon: "wrench" },
    { name: "Missing linen / laundry", icon: "bed" },
    { name: "No beds / clinical space", icon: "door" },
    { name: "IT & computer problems", icon: "monitor" },
    { name: "Can't reach the right staff", icon: "users" },
    { name: "Waiting for porters / transport", icon: "truck" },
    { name: "Supplies / stock shortages", icon: "box" },
    { name: "Medication / pharmacy delays", icon: "pill" },
    { name: "Cleaning / environment", icon: "sparkle" },
    { name: "Phone / communication issues", icon: "phone" },
    { name: "Admin / paperwork / handovers", icon: "clipboard" },
    { name: "Other", icon: "plusCircle" },
  ];

  // Optional emotional impact the reporter can attach.
  // Keep this list in sync with FEELINGS in server.js.
  const FEELINGS = [
    { name: "Frustrated", icon: "frustrated" },
    { name: "Embarrassed", icon: "embarrassed" },
    { name: "Resentful", icon: "resentful" },
    { name: "Undervalued", icon: "undervalued" },
    { name: "Helpless", icon: "helpless" },
    { name: "Cynical", icon: "cynical" },
  ];

  // Escalation routes — which team owns each issue type. Display-only, so this
  // map lives on the client; keys must match the CATEGORIES names above.
  const ROUTES = {
    "Searching for equipment": "Equipment / Medical devices",
    "Broken / faulty equipment": "Medical engineering (EBME)",
    "Missing linen / laundry": "Housekeeping / Linen services",
    "No beds / clinical space": "Bed management / Site team",
    "IT & computer problems": "IT service desk",
    "Can't reach the right staff": "Nurse in charge / Coordinator",
    "Waiting for porters / transport": "Portering / Logistics",
    "Supplies / stock shortages": "Stores / Procurement",
    "Medication / pharmacy delays": "Pharmacy",
    "Cleaning / environment": "Domestic services / Estates",
    "Phone / communication issues": "Telecoms / Switchboard",
    "Admin / paperwork / handovers": "Ward clerk / Admin",
    Other: "Ward manager",
  };

  function routeFor(category) {
    return ROUTES[category] || "Ward manager";
  }

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
  const feelingGroup = document.getElementById("feelingGroup");
  const identityGroup = document.getElementById("identityGroup");
  const submitBtn = document.getElementById("submitBtn");
  const formMsg = document.getElementById("formMsg");
  const routeHint = document.getElementById("routeHint");
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

  // Insights view
  const insightsView = document.getElementById("insightsView");
  const insightsContent = document.getElementById("insightsContent");
  const insightsRefreshBtn = document.getElementById("insightsRefreshBtn");

  // Emergency notification banner
  const emergencyBanner = document.getElementById("emergencyBanner");
  const emergencyText = document.getElementById("emergencyText");
  const emergencyDismiss = document.getElementById("emergencyDismiss");

  let selectedCategory = null;
  let manualCategory = false;
  let selectedPriority = "Medium";
  let selectedFeeling = null;
  let activeView = "report";

  // How the reporter chooses to identify. Anonymous is the default because staff
  // fear being labelled "complainers"; a nickname lets them follow up without
  // giving their real name. Keep modes in sync with IDENTITY_MODES in server.js.
  const IDENTITY_OPTIONS = [
    { mode: "anonymous", label: "Anonymous", icon: "shield" },
    { mode: "pseudonym", label: "Nickname", icon: "mask" },
    { mode: "named", label: "My name", icon: "user" },
  ];
  let selectedIdentity = "anonymous";

  // --- Build feeling chips (optional, single-select, tap again to clear) ---
  FEELINGS.forEach(function (f) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "feeling-chip";
    btn.dataset.feeling = f.name;
    btn.innerHTML =
      '<span class="chip-icon" aria-hidden="true">' + svgIcon(f.icon) + "</span>" +
      "<span>" + f.name + "</span>";
    btn.addEventListener("click", function () {
      selectedFeeling = selectedFeeling === f.name ? null : f.name;
      highlightFeeling(selectedFeeling);
    });
    feelingGroup.appendChild(btn);
  });

  function highlightFeeling(name) {
    feelingGroup.querySelectorAll(".feeling-chip").forEach(function (c) {
      c.classList.toggle("active", c.dataset.feeling === name);
    });
  }

  // --- Build identity chips (single-select; anonymous by default) ---
  IDENTITY_OPTIONS.forEach(function (opt) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "identity-btn";
    btn.dataset.identity = opt.mode;
    btn.innerHTML =
      '<span class="chip-icon" aria-hidden="true">' + svgIcon(opt.icon) + "</span>" +
      "<span>" + opt.label + "</span>";
    btn.addEventListener("click", function () {
      applyIdentity(opt.mode, true);
    });
    identityGroup.appendChild(btn);
  });

  function applyIdentity(mode, focusInput) {
    selectedIdentity = mode;
    identityGroup.querySelectorAll(".identity-btn").forEach(function (c) {
      c.classList.toggle("active", c.dataset.identity === mode);
    });
    const wantsName = mode !== "anonymous";
    reporterEl.classList.toggle("hidden", !wantsName);
    if (wantsName) {
      reporterEl.placeholder =
        mode === "pseudonym" ? "Nickname (e.g. Bay 3 nurse)" : "Your name (e.g. J. Smith)";
      if (focusInput) reporterEl.focus();
    } else {
      reporterEl.value = "";
    }
  }

  applyIdentity("anonymous", false);

  // --- Build category chips ---
  CATEGORIES.forEach(function (cat) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "category-chip";
    btn.dataset.category = cat.name;
    btn.innerHTML =
      '<span class="chip-icon" aria-hidden="true">' + svgIcon(cat.icon) + "</span>" +
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

  // Show which team a report will be routed to once a category is chosen.
  function updateRouteHint(name) {
    if (!name) {
      routeHint.classList.add("hidden");
      routeHint.textContent = "";
      return;
    }
    routeHint.classList.remove("hidden");
    routeHint.textContent = "This goes to: " + routeFor(name);
  }

  function applyCategory(name, manual) {
    selectedCategory = name;
    if (manual) manualCategory = true;
    highlightCategory(name);
    updateRouteHint(name);
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
    updateRouteHint(guess);
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
      insightsView.classList.toggle("hidden", view !== "insights");
      if (view === "list") loadRecentReports();
      if (view === "all") loadAllReports();
      if (view === "resolved") loadResolvedReports();
      if (view === "insights") loadInsights();
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
        reporter: selectedIdentity === "anonymous" ? "" : reporterEl.value.trim(),
        identity_mode: selectedIdentity,
        priority: selectedPriority,
        feeling: selectedFeeling,
      }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (r) {
        if (!r.ok) throw new Error(r.data.error || "Could not save report.");
        setFormMsg(
          "Report logged — your reference is " + refNum(r.data.id) +
            ". Find it under “Recent reports”.",
          "ok"
        );
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
    applyIdentity("anonymous", false);
    selectedCategory = null;
    manualCategory = false;
    highlightCategory(null);
    updateRouteHint(null);
    selectedFeeling = null;
    highlightFeeling(null);
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
    const originalLabel = btn.innerHTML;
    let armed = false;
    let timer = null;
    function disarm() {
      armed = false;
      btn.classList.remove("confirming");
      btn.innerHTML = originalLabel;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }
    btn.addEventListener("click", function () {
      if (!armed) {
        armed = true;
        btn.classList.add("confirming");
        btn.innerHTML = armedLabel;
        timer = setTimeout(disarm, 4000);
        return;
      }
      disarm();
      onConfirm();
    });
  }

  // Inline form shown before resolving a report: captures an optional outcome
  // ("what was done") and confirms the resolve. Emergency reports get a warning
  // label to guard against a misclick. Clicking Resolve again closes the form.
  function showResolveForm(actions, report, reloadFn) {
    const existing = actions.querySelector(".resolve-form");
    if (existing) {
      existing.remove();
      return;
    }

    const form = document.createElement("div");
    form.className = "resolve-form";

    const label = document.createElement("span");
    label.className = "confirm-label";
    label.textContent =
      report.priority === "Emergency"
        ? "Resolve this emergency?"
        : "Resolve this report?";

    const outcomeInput = document.createElement("input");
    outcomeInput.type = "text";
    outcomeInput.className = "ack-input";
    outcomeInput.placeholder = "What was done? (optional outcome)";
    outcomeInput.maxLength = 2000;
    if (report.outcome) outcomeInput.value = report.outcome;

    const row = document.createElement("div");
    row.className = "ack-actions";

    const yes = document.createElement("button");
    yes.type = "button";
    yes.className = "confirm-yes";
    yes.textContent = "Confirm resolve";

    const no = document.createElement("button");
    no.type = "button";
    no.className = "confirm-no";
    no.textContent = "Cancel";

    yes.addEventListener("click", function () {
      patchReport(
        report.id,
        { status: "Resolved", outcome: outcomeInput.value.trim() },
        reloadFn
      );
    });
    no.addEventListener("click", function () {
      form.remove();
    });

    form.appendChild(label);
    form.appendChild(outcomeInput);
    row.appendChild(yes);
    row.appendChild(no);
    form.appendChild(row);
    actions.appendChild(form);
    outcomeInput.focus();
  }

  // Inline form to add or edit a resolved report's outcome after the fact.
  function showOutcomeForm(actions, report, reloadFn) {
    const existing = actions.querySelector(".outcome-form");
    if (existing) {
      existing.remove();
      return;
    }

    const form = document.createElement("div");
    form.className = "outcome-form";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "ack-input";
    input.placeholder = "What was done about this?";
    input.maxLength = 2000;
    if (report.outcome) input.value = report.outcome;

    const row = document.createElement("div");
    row.className = "ack-actions";

    const save = document.createElement("button");
    save.type = "button";
    save.className = "confirm-yes";
    save.textContent = "Save outcome";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "confirm-no";
    cancel.textContent = "Cancel";

    save.addEventListener("click", function () {
      patchReport(report.id, { outcome: input.value.trim() }, reloadFn);
    });
    cancel.addEventListener("click", function () {
      form.remove();
    });

    row.appendChild(save);
    row.appendChild(cancel);
    form.appendChild(input);
    form.appendChild(row);
    actions.appendChild(form);
    input.focus();
  }

  // --- Progress updates (timestamped log per report) ---
  function addUpdatesSection(actions, report, reloadFn) {
    const wrap = document.createElement("div");
    wrap.className = "updates-wrap";

    const count = report.update_count || 0;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "updates-toggle";
    toggle.innerHTML =
      svgIcon("note") +
      "<span>" +
      (count ? "Progress updates (" + count + ")" : "Add progress update") +
      "</span>";

    const panel = document.createElement("div");
    panel.className = "updates-panel hidden";
    let loaded = false;

    toggle.addEventListener("click", function () {
      const nowHidden = panel.classList.toggle("hidden");
      if (!nowHidden && !loaded) {
        loadUpdates(report.id, panel, reloadFn).then(function (ok) {
          if (ok) loaded = true;
        });
      }
    });

    wrap.appendChild(toggle);
    wrap.appendChild(panel);
    actions.appendChild(wrap);
  }

  function loadUpdates(reportId, panel, reloadFn) {
    panel.innerHTML = '<p class="updates-empty">Loading...</p>';
    return fetch("/api/reports/" + reportId + "/updates")
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (updates) {
        renderUpdates(reportId, panel, updates, reloadFn);
        return true;
      })
      .catch(function () {
        panel.innerHTML = '<p class="updates-empty">Could not load updates.</p>';
        return false;
      });
  }

  function renderUpdates(reportId, panel, updates, reloadFn) {
    panel.innerHTML = "";

    const log = document.createElement("div");
    log.className = "updates-log";
    if (!updates || updates.length === 0) {
      log.innerHTML = '<p class="updates-empty">No updates yet — add the first one.</p>';
    } else {
      updates.forEach(function (u) {
        const entry = document.createElement("div");
        entry.className = "update-entry";
        entry.innerHTML =
          '<p class="update-note">' + escapeHtml(u.note) + "</p>" +
          '<span class="update-meta">— ' +
            (u.author ? escapeHtml(u.author) : "Staff") + ", " +
            formatTime(u.created_at) +
          "</span>";
        log.appendChild(entry);
      });
    }
    panel.appendChild(log);

    const form = document.createElement("div");
    form.className = "update-form";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "ack-input";
    nameInput.placeholder = "Your name (optional)";
    nameInput.maxLength = 120;

    const noteInput = document.createElement("input");
    noteInput.type = "text";
    noteInput.className = "ack-input";
    noteInput.placeholder = "Add a progress update…";
    noteInput.maxLength = 1000;

    const row = document.createElement("div");
    row.className = "ack-actions";

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "confirm-yes";
    addBtn.textContent = "Post update";

    addBtn.addEventListener("click", function () {
      const note = noteInput.value.trim();
      if (!note) {
        noteInput.focus();
        return;
      }
      addBtn.disabled = true;
      fetch("/api/reports/" + reportId + "/updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note, author: nameInput.value.trim() }),
      })
        .then(function (res) {
          if (!res.ok) throw new Error();
          return res.json();
        })
        .then(function () {
          if (reloadFn) reloadFn();
        })
        .catch(function () {
          addBtn.disabled = false;
        });
    });

    row.appendChild(addBtn);
    form.appendChild(nameInput);
    form.appendChild(noteInput);
    form.appendChild(row);
    panel.appendChild(form);
  }

  // Inline form to acknowledge a report and, optionally, record who acknowledged
  // it and a short response. Clicking the button again closes the open form.
  function showAckForm(actions, report, reloadFn) {
    const existing = actions.querySelector(".ack-form");
    if (existing) {
      existing.remove();
      return;
    }

    const form = document.createElement("div");
    form.className = "ack-form";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "ack-input";
    nameInput.placeholder = "Your name (optional)";
    nameInput.maxLength = 120;

    const noteInput = document.createElement("input");
    noteInput.type = "text";
    noteInput.className = "ack-input";
    noteInput.placeholder = "Add a response (optional)";
    noteInput.maxLength = 1000;

    const row = document.createElement("div");
    row.className = "ack-actions";

    const yes = document.createElement("button");
    yes.type = "button";
    yes.className = "confirm-yes";
    yes.innerHTML = svgIcon("check") + "<span>Acknowledge</span>";

    const no = document.createElement("button");
    no.type = "button";
    no.className = "confirm-no";
    no.textContent = "Cancel";

    yes.addEventListener("click", function () {
      patchReport(
        report.id,
        {
          acknowledged: true,
          acknowledged_by: nameInput.value.trim(),
          response_note: noteInput.value.trim(),
        },
        reloadFn
      );
    });
    no.addEventListener("click", function () {
      form.remove();
    });

    row.appendChild(yes);
    row.appendChild(no);
    form.appendChild(nameInput);
    form.appendChild(noteInput);
    form.appendChild(row);
    actions.appendChild(form);
    nameInput.focus();
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

  // Human-friendly reference number shown to the reporter on submit.
  function refNum(id) {
    return "WR-" + String(id).padStart(4, "0");
  }

  // How a report is attributed on its card. Protects psychological safety:
  // anonymous shows a shield, a nickname shows a mask (identity withheld), and a
  // real name shows "by …". Never leaks a name the reporter didn't choose to give.
  function reporterByline(r) {
    const mode = r.identity_mode || (r.reporter ? "named" : "anonymous");
    if (mode === "anonymous" || !r.reporter) {
      return '<span class="who who-anon">' + svgIcon("shield") + "Anonymous</span>";
    }
    if (mode === "pseudonym") {
      return (
        '<span class="who who-alias">' + svgIcon("mask") + escapeHtml(r.reporter) + "</span>"
      );
    }
    return "by " + escapeHtml(r.reporter);
  }

  // Turn a number of minutes into a short "2h 15m" / "3d 4h" style label.
  function formatDuration(minutes) {
    if (minutes < 1) return "under a minute";
    if (minutes < 60) return minutes + " min";
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h < 24) return m ? h + "h " + m + "m" : h + "h";
    const days = Math.floor(h / 24);
    const rh = h % 24;
    return rh ? days + "d " + rh + "h" : days + "d";
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
      meta.push(reporterByline(r));
      meta.push(formatTime(r.created_at));
      meta.push(escapeHtml(r.priority) + " priority");
      if (resolvedView && r.resolved_at) {
        meta.push("resolved " + formatTime(r.resolved_at));
      }

      const statusClass = r.status === "In progress" ? "In-progress" : r.status;
      const flag = isEmergency
        ? '<span class="emergency-flag">' + svgIcon("alert") + "Emergency</span>"
        : "";

      const ackPill = r.acknowledged_at
        ? '<span class="ack-pill">' + svgIcon("check") + "Acknowledged</span>"
        : "";
      const feelingTag = r.feeling
        ? '<div class="feeling-tag">Reporter felt <strong>' +
            escapeHtml(r.feeling) +
          "</strong></div>"
        : "";
      const ackNote = r.acknowledged_at
        ? '<div class="ack-note">' +
            (r.response_note
              ? '<span class="ack-note-text">“' + escapeHtml(r.response_note) + "”</span>"
              : '<span class="ack-note-text ack-note-plain">Seen and acknowledged.</span>') +
            '<span class="ack-note-by">— ' +
              (r.acknowledged_by ? escapeHtml(r.acknowledged_by) : "Staff") +
              ", " + formatTime(r.acknowledged_at) +
            "</span>" +
          "</div>"
        : "";

      const routeTag =
        '<div class="route-tag">Routes to <strong>' +
          escapeHtml(routeFor(r.category)) +
        "</strong></div>";

      const outcomeBlock = r.outcome
        ? '<div class="outcome-block"><span class="outcome-label">Outcome</span> ' +
            escapeHtml(r.outcome) +
          "</div>"
        : "";

      item.innerHTML =
        '<div class="report-top">' +
          '<span class="report-cat">' + escapeHtml(r.category) + flag + "</span>" +
          '<span class="report-badges">' +
            '<span class="badge ' + statusClass + '">' + escapeHtml(r.status) + "</span>" +
            ackPill +
          "</span>" +
        "</div>" +
        '<p class="report-desc">' + escapeHtml(r.description) + "</p>" +
        routeTag +
        feelingTag +
        outcomeBlock +
        ackNote +
        '<div class="report-meta"><span class="report-ref">' + refNum(r.id) +
          "</span> • " + meta.join(" • ") + "</div>";

      const actions = document.createElement("div");
      actions.className = "report-actions";

      if (resolvedView) {
        // In the resolved section, offer to re-open (unresolve) the report.
        // Reviving an emergency needs a confirming second click.
        const unBtn = document.createElement("button");
        unBtn.type = "button";
        unBtn.className = "unresolve-btn";
        unBtn.innerHTML = svgIcon("undo") + "<span>Unresolve</span>";
        if (isEmergency) {
          armConfirm(unBtn, svgIcon("alert") + "<span>Click again to revive</span>", function () {
            patchReport(r.id, { status: "Open" }, reloadFn);
          });
        } else {
          unBtn.addEventListener("click", function () {
            patchReport(r.id, { status: "Open" }, reloadFn);
          });
        }
        actions.appendChild(unBtn);

        const outBtn = document.createElement("button");
        outBtn.type = "button";
        outBtn.className = "outcome-btn";
        outBtn.textContent = r.outcome ? "Edit outcome" : "Add outcome";
        outBtn.addEventListener("click", function () {
          showOutcomeForm(actions, r, reloadFn);
        });
        actions.appendChild(outBtn);
      } else {
        // Status is changed via a row of buttons; the current status is shown
        // active (non-clickable), the others switch to that status on click.
        const statusRow = document.createElement("div");
        statusRow.className = "status-btns";
        ["Open", "In progress", "Resolved"].forEach(function (s) {
          const sBtn = document.createElement("button");
          sBtn.type = "button";
          sBtn.dataset.status = s;
          sBtn.textContent = s;
          if (s === r.status) {
            sBtn.className = "status-btn active";
          } else {
            sBtn.className = "status-btn";
            sBtn.addEventListener("click", function () {
              // Resolving always opens an inline form so the outcome ("what was
              // done") can be captured; other status changes apply immediately.
              if (s === "Resolved") {
                showResolveForm(actions, r, reloadFn);
                return;
              }
              patchReport(r.id, { status: s }, reloadFn);
            });
          }
          statusRow.appendChild(sBtn);
        });
        actions.appendChild(statusRow);

        if (!isEmergency) {
          const emBtn = document.createElement("button");
          emBtn.type = "button";
          emBtn.className = "emergency-btn";
          emBtn.innerHTML = svgIcon("alert") + "<span>Mark emergency</span>";
          armConfirm(emBtn, svgIcon("alert") + "<span>Click again to confirm</span>", function () {
            emBtn.disabled = true;
            patchReport(r.id, { priority: "Emergency" }, reloadFn);
          });
          actions.appendChild(emBtn);
        }

        // Acknowledgement / response — record that the report has been seen.
        if (r.acknowledged_at) {
          const clearBtn = document.createElement("button");
          clearBtn.type = "button";
          clearBtn.className = "ack-clear-btn";
          clearBtn.textContent = "Clear acknowledgement";
          clearBtn.addEventListener("click", function () {
            patchReport(r.id, { acknowledged: false }, reloadFn);
          });
          actions.appendChild(clearBtn);
        } else {
          const ackBtn = document.createElement("button");
          ackBtn.type = "button";
          ackBtn.className = "ack-btn";
          ackBtn.innerHTML = svgIcon("check") + "<span>Acknowledge / respond</span>";
          ackBtn.addEventListener("click", function () {
            showAckForm(actions, r, reloadFn);
          });
          actions.appendChild(ackBtn);
        }
      }

      // Progress updates — expandable, lazy-loaded log + add form.
      addUpdatesSection(actions, r, reloadFn);

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

  // --- Insights & learning ---
  function loadInsights() {
    insightsContent.innerHTML = '<p class="empty">Loading...</p>';
    fetch("/api/insights")
      .then(function (res) { return res.json(); })
      .then(function (data) { renderInsights(data); })
      .catch(function () {
        insightsContent.innerHTML =
          '<p class="empty">Could not load insights. Try again.</p>';
      });
  }

  if (insightsRefreshBtn) {
    insightsRefreshBtn.addEventListener("click", loadInsights);
  }

  function statCard(value, label) {
    return '<div class="stat"><span class="stat-value">' + value +
      '</span><span class="stat-label">' + label + "</span></div>";
  }

  function barList(rows, key, emptyMsg) {
    if (!rows || rows.length === 0) {
      return '<p class="updates-empty">' + emptyMsg + "</p>";
    }
    const max = rows.reduce(function (m, r) {
      return r.count > m ? r.count : m;
    }, 0) || 1;
    return rows
      .map(function (r) {
        const pct = Math.round((r.count / max) * 100);
        return '<div class="bar-row">' +
          '<span class="bar-label">' + escapeHtml(r[key]) + "</span>" +
          '<span class="bar-track"><span class="bar-fill" style="width:' + pct + '%"></span></span>' +
          '<span class="bar-count">' + r.count + "</span>" +
        "</div>";
      })
      .join("");
  }

  function renderInsights(d) {
    if (!d || !d.totals) {
      insightsContent.innerHTML = '<p class="empty">No data yet.</p>';
      return;
    }
    const t = d.totals;
    const avg =
      d.avgResolveMinutes === null ? "—" : formatDuration(d.avgResolveMinutes);

    insightsContent.innerHTML =
      '<div class="card">' +
        '<div class="stat-grid">' +
          statCard(t.total, "Total reports") +
          statCard(t.open + t.in_progress, "Still open") +
          statCard(t.resolved, "Resolved") +
          statCard(avg, "Avg. time to resolve") +
          statCard(d.acknowledgedRate + "%", "Acknowledged") +
          statCard(d.updatesTotal, "Progress updates") +
        "</div>" +
      "</div>" +
      '<div class="card">' +
        '<h3 class="insights-h">Reports by issue type</h3>' +
        barList(d.byCategory, "category", "No reports yet.") +
      "</div>" +
      '<div class="card">' +
        '<h3 class="insights-h">How reporters felt</h3>' +
        barList(d.byFeeling, "feeling", "No feelings recorded yet.") +
      "</div>" +
      '<div class="card">' +
        '<h3 class="insights-h">Reports by priority</h3>' +
        barList(d.byPriority, "priority", "No reports yet.") +
      "</div>";
  }

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
