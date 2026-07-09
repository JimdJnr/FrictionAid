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
    chevron: '<polyline points="6 9 12 15 18 9"/>',
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
  const priorityGroup = document.getElementById("priorityGroup");
  const feelingGroup = document.getElementById("feelingGroup");
  const submitBtn = document.getElementById("submitBtn");
  const formMsg = document.getElementById("formMsg");
  const routeHint = document.getElementById("routeHint");
  const voiceBtn = document.getElementById("voiceBtn");
  const voiceLabel = document.getElementById("voiceLabel");
  const voiceStatus = document.getElementById("voiceStatus");
  const locVoiceBtn = document.getElementById("locVoiceBtn");
  const locVoiceLabel = document.getElementById("locVoiceLabel");
  const locVoiceStatus = document.getElementById("locVoiceStatus");
  const feelVoiceBtn = document.getElementById("feelVoiceBtn");
  const feelVoiceLabel = document.getElementById("feelVoiceLabel");
  const feelVoiceStatus = document.getElementById("feelVoiceStatus");
  const unsupportedEl = document.getElementById("unsupported");
  // Wizard controls
  const wizardProgress = document.getElementById("wizardProgress");
  const wizardSteps = document.querySelectorAll(".wizard-step");
  const toLocationBtn = document.getElementById("toLocationBtn");
  const backToDescribeBtn = document.getElementById("backToDescribeBtn");
  const toFeelingBtn = document.getElementById("toFeelingBtn");
  const backToLocationBtn = document.getElementById("backToLocationBtn");
  const tabs = document.querySelectorAll(".tab, .bottomnav-btn, .ol-nav-item, .ol-compose, .moresheet-item, .compose-fab");
  const composeFab = document.getElementById("composeFab");
  const moreBtn = document.getElementById("moreBtn");
  const moreSheet = document.getElementById("moreSheet");
  const moreBackdrop = document.getElementById("moreBackdrop");
  const MORE_VIEWS = ["hospitals", "staff", "profile"];
  const reportView = document.getElementById("reportView");
  const listView = document.getElementById("listView");
  const allView = document.getElementById("allView");
  const resolvedView = document.getElementById("resolvedView");
  const profileView = document.getElementById("profileView");
  const hospitalsView = document.getElementById("hospitalsView");
  const staffView = document.getElementById("staffView");

  // Profile / settings + AI assistant
  const settingsBtn = document.getElementById("settingsBtn");
  const profileBackBtn = document.getElementById("profileBackBtn");
  const profileNameEl = document.getElementById("profileName");
  const profileMetaEl = document.getElementById("profileMeta");
  const profileAvatarEl = document.getElementById("profileAvatar");
  const autostartToggle = document.getElementById("autostartToggle");
  const settingsMsg = document.getElementById("settingsMsg");
  // Profile edit
  const editFirstName = document.getElementById("editFirstName");
  const editLastName = document.getElementById("editLastName");
  const editProfession = document.getElementById("editProfession");
  const editAlias = document.getElementById("editAlias");
  const avatarPreview = document.getElementById("avatarPreview");
  const avatarInput = document.getElementById("avatarInput");
  const avatarPickBtn = document.getElementById("avatarPickBtn");
  const avatarClearBtn = document.getElementById("avatarClearBtn");
  const profileSaveBtn = document.getElementById("profileSaveBtn");
  const profileMsg = document.getElementById("profileMsg");
  let pendingAvatar; // undefined = unchanged, null = remove, string = new data URL
  // Appearance
  const themeSwatches = document.getElementById("themeSwatches");
  const fontScaleBtns = document.getElementById("fontScaleBtns");
  const darkModeToggle = document.getElementById("darkModeToggle");
  const appearanceMsg = document.getElementById("appearanceMsg");
  // Hospitals & staff
  const hospitalsListEl = document.getElementById("hospitalsList");
  const staffListEl = document.getElementById("staffList");
  const staffRefreshBtn = document.getElementById("staffRefreshBtn");

  const THEME_COLORS = ["#0f6cbd", "#107c41", "#8764b8", "#c4314b", "#d83b01", "#038387"];
  const FONT_SCALES = ["small", "medium", "large"];
  const FONT_SIZES = { small: "14px", medium: "16px", large: "18px" };
  const assistStart = document.getElementById("assistStart");
  const assistMessages = document.getElementById("assistMessages");
  const assistInputRow = document.getElementById("assistInputRow");
  const assistInput = document.getElementById("assistInput");
  const assistSend = document.getElementById("assistSend");
  let currentUser = null;

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

  const descPrompt = document.getElementById("descPrompt");
  const autofillNote = document.getElementById("autofillNote");
  const clearDescBtn = document.getElementById("clearDescBtn");

  let selectedCategory = null;
  let manualCategory = false;
  let selectedPriority = "Medium";
  let selectedFeeling = null;
  let activeView = "report";

  // Track which fields the reporter set by hand. Auto-fill (derived from the
  // description) only ever touches fields the reporter hasn't touched, so it
  // never overrides a deliberate choice.
  let manualPriority = false;
  let manualFeeling = false;
  let manualLocation = false;

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
      manualFeeling = true;
      selectedFeeling = selectedFeeling === f.name ? null : f.name;
      highlightFeeling(selectedFeeling);
      showDescPrompt();
    });
    feelingGroup.appendChild(btn);
  });

  function highlightFeeling(name) {
    feelingGroup.querySelectorAll(".feeling-chip").forEach(function (c) {
      c.classList.toggle("active", c.dataset.feeling === name);
    });
  }

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
      showDescPrompt();
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

  // --- Auto-fill other fields from the description --------------------------
  // Best-guess, keyword/pattern based. It only ever writes to fields the
  // reporter hasn't touched, and everything can still be corrected by hand
  // before submitting. Urgent language maps to "High" — Emergency is left to
  // the reporter's deliberate, guarded choice so free text can't silently fire
  // an emergency broadcast.

  // Feeling keywords, mapped to the FEELINGS allowlist.
  const FEELING_KEYWORDS = [
    { name: "Frustrated", words: ["frustrat", "fed up", "annoyed", "annoying", "irritat", "sick of"] },
    { name: "Embarrassed", words: ["embarrass", "ashamed", "humiliat", "awkward"] },
    { name: "Resentful", words: ["resent", "bitter", "unfair", "not fair"] },
    { name: "Undervalued", words: ["undervalued", "unappreciat", "not valued", "taken for granted", "unrecognis", "unrecogniz", "not listened", "ignored"] },
    { name: "Helpless", words: ["helpless", "powerless", "hopeless", "nothing i can do", "nothing we can do", "can't do anything", "cannot do anything", "at a loss", "stuck"] },
    { name: "Cynical", words: ["cynical", "pointless", "nothing changes", "nothing ever changes", "waste of time", "same old", "here we go again"] },
  ];

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function hasPhrase(text, phrase) {
    return new RegExp("(^|[^a-z])" + escapeRe(phrase) + "([^a-z]|$)", "i").test(text);
  }

  function detectPriority(t) {
    const low = ["low priority", "no rush", "not urgent", "non urgent", "non-urgent", "no hurry", "whenever", "when you get a chance", "when you can", "at some point", "minor", "no great rush"];
    const high = ["urgent", "asap", "as soon as possible", "straight away", "right away", "immediately", "right now", "high priority", "critical", "can't wait", "cannot wait", "emergency", "life threatening", "life-threatening", "deteriorating", "unsafe", "very important", "quickly"];
    // Low is checked first so "not urgent" / "no rush" win over the "urgent"
    // substring. Word-boundary matching stops "urgent" firing inside e.g.
    // "insurgent".
    for (let i = 0; i < low.length; i++) if (hasPhrase(t, low[i])) return "Low";
    // Neutralise negated urgency ("not an emergency", "isn't urgent") so it
    // doesn't read as High.
    const cleaned = t.replace(
      /\b(?:not|no|isn'?t|non)\s+(?:an?\s+)?(?:emergency|urgent|critical|unsafe|rush|hurry)\b/gi,
      " "
    );
    for (let i = 0; i < high.length; i++) if (hasPhrase(cleaned, high[i])) return "High";
    return null;
  }

  function detectFeeling(t) {
    let best = null;
    let bestScore = 0;
    FEELING_KEYWORDS.forEach(function (entry) {
      let score = 0;
      entry.words.forEach(function (w) { if (t.indexOf(w) !== -1) score++; });
      if (score > bestScore) { bestScore = score; best = entry.name; }
    });
    return best;
  }

  function titleCaseWords(s) {
    return s.replace(/\s+/g, " ").trim().replace(/\b([a-z])(\w*)/gi, function (_, a, b) {
      return a.toUpperCase() + b;
    });
  }

  function detectLocation(raw) {
    const unit = "(?:ward|bay|bed|room|side\\s*room|cubicle|cubical|theatre|theater|unit|clinic|floor|level)";
    const chain = new RegExp(
      "\\b(" + unit + "\\s*\\.?\\s*\\d+[a-z]?(?:\\s+" + unit + "\\s*\\.?\\s*\\d+[a-z]?)*)", "i"
    );
    const m = raw.match(chain);
    if (m) return titleCaseWords(m[1]);
    // "3rd floor", "ground floor", "second floor"
    const floor = raw.match(/\b((?:ground|first|second|third|fourth|fifth|top|lower|upper|\d+(?:st|nd|rd|th)?)\s+floor)\b/i);
    if (floor) return titleCaseWords(floor[1]);
    const named = raw.match(/\b(resus|a&e|a and e|majors|minors|icu|itu|hdu|nicu|scbu|recovery|day room|day unit|nurses'? station|reception|store cupboard|store room|stores?|treatment room|sluice|pharmacy|waiting room|corridor|kitchen|kitchenette|toilets?|bathroom|washroom|endoscopy|radiology|x-?ray|outpatients|dining room|staff ?room|linen room|equipment (?:store|room)|dispensary|nursery|maternity|paediatrics|pediatrics|oncology|cardiology)\b/i);
    if (named) {
      const val = named[1];
      return /^a\s*&\s*e$|^a and e$/i.test(val) ? "A&E" : titleCaseWords(val);
    }
    return "";
  }

  // Re-derive untouched fields from the current description and note what was
  // auto-filled so the reporter can see (and correct) it.
  function maybeAutoFill(text) {
    const raw = text || "";
    const t = raw.toLowerCase();
    const filled = [];

    if (!manualPriority) {
      const p = detectPriority(t) || "Medium";
      setPriority(p);
      if (p !== "Medium") filled.push("priority");
    }
    if (!manualFeeling) {
      const f = detectFeeling(t);
      selectedFeeling = f;
      highlightFeeling(f);
      if (f) filled.push("feeling");
    }
    if (!manualLocation) {
      const loc = detectLocation(raw);
      locationEl.value = loc;
      if (loc) filled.push("location");
    }
    showAutofillNote(filled);
  }

  function showAutofillNote(fields) {
    if (!autofillNote) return;
    if (!fields.length) {
      autofillNote.classList.add("hidden");
      autofillNote.textContent = "";
      return;
    }
    autofillNote.textContent = "Auto-filled from your words: " + fields.join(", ") +
      ". Tap any field to change it.";
    autofillNote.classList.remove("hidden");
  }

  // --- "Please describe it" prompt -----------------------------------------
  // Nudges the reporter to describe the issue if they start setting other
  // fields (or try to submit) while the description is still empty.
  function showDescPrompt() {
    if (!descPrompt) return;
    if (descriptionEl.value.trim()) return;
    descPrompt.classList.remove("hidden");
  }
  function hideDescPrompt() {
    if (descPrompt) descPrompt.classList.add("hidden");
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

    manualPriority = true;
    setPriority(btn.dataset.priority);
    showDescPrompt();
  });

  // Set the priority programmatically (used by both a manual click and by
  // auto-fill) and reflect it in the button row.
  function setPriority(name) {
    selectedPriority = name;
    priorityGroup.querySelectorAll(".priority-btn").forEach(function (b) {
      b.classList.toggle("active", b.dataset.priority === name);
    });
    // Priority decides whether the "How you feel" step applies, so keep the
    // wizard progress + step-2 primary button label in sync.
    if (typeof updateWizardProgress === "function") updateWizardProgress();
  }

  // Typing into location or the name field counts as a manual choice, so
  // auto-fill leaves those fields alone from then on.
  // Engaging another field with no description yet triggers the nudge (the
  // prompt itself no-ops when the description already has content).
  locationEl.addEventListener("input", function () {
    manualLocation = true;
    showDescPrompt();
  });
  locationEl.addEventListener("focus", showDescPrompt);

  // Description drives category + field auto-fill (typing or dictation).
  descriptionEl.addEventListener("input", handleDescriptionChange);
  descriptionEl.addEventListener("focus", hideDescPrompt);

  function handleDescriptionChange() {
    hideDescPrompt();
    maybeAutoCategorize();
    maybeAutoFill(descriptionEl.value);
    updateClearBtn();
    updateWizardControls();
  }

  // Show the "Clear" button only when there's something to clear.
  function updateClearBtn() {
    if (!clearDescBtn) return;
    clearDescBtn.classList.toggle("hidden", !descriptionEl.value.trim());
  }

  // Clearing the description also clears anything auto-filled from it (untouched
  // fields), while leaving any choices the reporter made by hand intact.
  if (clearDescBtn) {
    clearDescBtn.addEventListener("click", function () {
      descriptionEl.value = "";
      handleDescriptionChange();
      descriptionEl.focus();
    });
  }

  function setFormMsg(text, type) {
    formMsg.textContent = text;
    formMsg.className = "form-msg" + (type ? " " + type : "");
  }

  // --- Tab switching (top tabs + mobile bottom nav stay in sync) ---
  function activateView(view) {
    activeView = view;
    tabs.forEach(function (t) {
      const isActive = t.dataset.view === view;
      t.classList.toggle("active", isActive);
      if (isActive) {
        t.setAttribute("aria-current", "page");
      } else {
        t.removeAttribute("aria-current");
      }
    });
    reportView.classList.toggle("hidden", view !== "report");
    listView.classList.toggle("hidden", view !== "list");
    allView.classList.toggle("hidden", view !== "all");
    resolvedView.classList.toggle("hidden", view !== "resolved");
    insightsView.classList.toggle("hidden", view !== "insights");
    if (profileView) profileView.classList.toggle("hidden", view !== "profile");
    if (hospitalsView) hospitalsView.classList.toggle("hidden", view !== "hospitals");
    if (staffView) staffView.classList.toggle("hidden", view !== "staff");
    const viewEl =
      view === "report" ? reportView :
      view === "list" ? listView :
      view === "all" ? allView :
      view === "resolved" ? resolvedView :
      view === "profile" ? profileView :
      view === "hospitals" ? hospitalsView :
      view === "staff" ? staffView : insightsView;
    animateViewIn(viewEl);
    // The mobile "More" button stands in for its grouped destinations.
    if (moreBtn) moreBtn.classList.toggle("active", MORE_VIEWS.indexOf(view) !== -1);
    closeMoreSheet();
    if (view === "list") loadRecentReports();
    if (view === "all") loadAllReports();
    if (view === "resolved") loadResolvedReports();
    if (view === "insights") loadInsights();
    if (view === "profile") populateProfile();
    if (view === "hospitals") loadHospitals();
    if (view === "staff") loadStaff();
  }
  tabs.forEach(function (tab) {
    // #moreBtn is a .bottomnav-btn but has no data-view (it opens the sheet),
    // so skip it here — its own handler below toggles the sheet.
    if (!tab.dataset.view) return;
    tab.addEventListener("click", function () {
      activateView(tab.dataset.view);
    });
  });

  // --- Mobile "More" sheet (Hospitals / Staff online / Settings) ---
  function openMoreSheet() {
    if (!moreSheet) return;
    moreSheet.classList.remove("hidden");
    if (moreBackdrop) moreBackdrop.classList.remove("hidden");
    if (moreBtn) moreBtn.setAttribute("aria-expanded", "true");
  }
  function closeMoreSheet() {
    if (!moreSheet) return;
    moreSheet.classList.add("hidden");
    if (moreBackdrop) moreBackdrop.classList.add("hidden");
    if (moreBtn) moreBtn.setAttribute("aria-expanded", "false");
  }
  if (moreBtn) {
    moreBtn.addEventListener("click", function () {
      if (moreSheet && moreSheet.classList.contains("hidden")) openMoreSheet();
      else closeMoreSheet();
    });
  }
  if (moreBackdrop) moreBackdrop.addEventListener("click", closeMoreSheet);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeMoreSheet();
  });

  // Re-trigger the staggered "rise in" animation on a view's direct children
  // each time it's shown (removing + forcing reflow + re-adding the class).
  function animateViewIn(el) {
    el.classList.remove("animate-in");
    void el.offsetWidth;
    el.classList.add("animate-in");
  }
  // Animate the default (New report) view in on first paint.
  animateViewIn(reportView);

  // Reload whichever list is currently visible (used after live updates).
  function reloadActiveView() {
    if (activeView === "list") loadRecentReports();
    else if (activeView === "all") loadAllReports();
    else if (activeView === "resolved") loadResolvedReports();
  }

  // --- Submit report ---
  submitBtn.addEventListener("click", submitReport);

  function submitReport() {
    if (listening) stopVoice();
    const description = descriptionEl.value.trim();
    if (!description) {
      setFormMsg("Please describe the issue (speak or type).", "error");
      goToStep(1);
      showDescPrompt();
      descriptionEl.focus();
      return;
    }
    // Last-chance category: match keywords, else capture under "Other" so the
    // full typed/spoken description is still recorded rather than blocking submit.
    if (!selectedCategory) {
      applyCategory(autoCategorize(description) || "Other", false);
    }

    submitBtn.disabled = true;
    if (toFeelingBtn) toFeelingBtn.disabled = true;
    setFormMsg("Sending...", "");

    fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: selectedCategory,
        description: description,
        location: locationEl.value.trim(),
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
        if (toFeelingBtn) toFeelingBtn.disabled = false;
      });
  }

  // --- Report wizard (Describe → Location → How you feel) -------------------
  // Step 3 ("How did this make you feel?") is only shown when the issue reads as
  // Medium priority or worse; a Low-priority issue finishes straight from the
  // location step. Emergency stays a manual, two-step-confirmed choice.
  let wizStep = 1;

  function feelingApplies() {
    return selectedPriority !== "Low";
  }

  function updateWizardProgress() {
    const showFeeling = feelingApplies();
    wizardProgress.querySelectorAll(".wiz-seg").forEach(function (seg) {
      const step = Number(seg.dataset.step);
      seg.classList.toggle("active", step === wizStep);
      seg.classList.toggle("done", step < wizStep);
      if (step === 3) seg.classList.toggle("skip", !showFeeling);
    });
    if (toFeelingBtn) {
      toFeelingBtn.textContent = showFeeling ? "Next: How you feel →" : "Submit report";
    }
  }

  // Enable "Next: Location" only once there's a description to work with.
  function updateWizardControls() {
    if (toLocationBtn) toLocationBtn.disabled = !descriptionEl.value.trim();
  }

  function goToStep(n) {
    if (listening) stopVoice();
    wizStep = n;
    wizardSteps.forEach(function (s) {
      s.classList.toggle("active", Number(s.dataset.step) === n);
    });
    updateWizardProgress();
    const container = document.querySelector(".container");
    if (container) container.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (toLocationBtn) {
    toLocationBtn.addEventListener("click", function () {
      resetVoiceFlow(); // a manual tap means the reporter is driving now
      const description = descriptionEl.value.trim();
      if (!description) {
        setFormMsg("Please describe the issue (speak or type).", "error");
        showDescPrompt();
        descriptionEl.focus();
        return;
      }
      if (!selectedCategory) applyCategory(autoCategorize(description) || "Other", false);
      setFormMsg("", "");
      goToStep(2);
      locationEl.focus();
    });
  }
  if (backToDescribeBtn) {
    backToDescribeBtn.addEventListener("click", function () { resetVoiceFlow(); goToStep(1); });
  }
  if (toFeelingBtn) {
    toFeelingBtn.addEventListener("click", function () {
      resetVoiceFlow();
      if (feelingApplies()) goToStep(3);
      else submitReport();
    });
  }
  if (backToLocationBtn) {
    backToLocationBtn.addEventListener("click", function () { resetVoiceFlow(); goToStep(2); });
  }

  function resetForm() {
    descriptionEl.value = "";
    locationEl.value = "";
    selectedCategory = null;
    manualCategory = false;
    highlightCategory(null);
    updateRouteHint(null);
    selectedFeeling = null;
    highlightFeeling(null);
    disarmEmergencyPriority();
    setPriority("Medium");
    manualPriority = false;
    manualFeeling = false;
    manualLocation = false;
    hideDescPrompt();
    showAutofillNote([]);
    updateClearBtn();
    updateWizardControls();
    resetAssist();
    resetVoiceFlow();
    // The feeling target has no real input, so its scratch transcript won't be
    // cleared by emptying a field — reset it here or a prior report's spoken
    // feeling could bleed into the next one via baseText/detectFeeling.
    VOICE_TARGETS.feeling.input.value = "";
    goToStep(1);
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
        body: JSON.stringify({ note: note }),
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
    form.appendChild(noteInput);
    form.appendChild(row);
    actions.appendChild(form);
    noteInput.focus();
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

  // How a report is attributed on its card. Reports are now tied to a signed-in
  // account, so we show the reporter's real name (and profession). Legacy rows
  // with no linked account fall back to the old free-text reporter or "Staff".
  function reporterByline(r) {
    const name = [r.reporter_first_name, r.reporter_last_name]
      .filter(Boolean)
      .join(" ")
      .trim();
    if (name) {
      const prof = r.reporter_profession
        ? ' <span class="who-role">· ' + escapeHtml(r.reporter_profession) + "</span>"
        : "";
      return "by " + escapeHtml(name) + prof;
    }
    if (r.reporter) return "by " + escapeHtml(r.reporter);
    return "by Staff";
  }

  // Two-letter initials for a report's sender, for the email-style avatar.
  function reporterInitials(r) {
    const f = (r.reporter_first_name || "").trim();
    const l = (r.reporter_last_name || "").trim();
    if (f || l) {
      return ((f[0] || "") + (l[0] || "")).toUpperCase() || "?";
    }
    const rep = (r.reporter || "Staff").trim();
    const parts = rep.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return (rep.slice(0, 2) || "?").toUpperCase();
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
    reports.forEach(function (r, i) {
      const isEmergency = r.priority === "Emergency";
      const item = document.createElement("div");
      item.className = "report-item p-" + r.priority;
      // Staggered entrance; cap the delay so long lists don't crawl in.
      item.style.animationDelay = Math.min(i, 12) * 35 + "ms";

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

      // Email-style avatar (reporter's picture, else their initials).
      const senderName = [r.reporter_first_name, r.reporter_last_name]
        .filter(Boolean).join(" ").trim() || r.reporter || "Staff";
      const senderInitials = reporterInitials(r);
      // Avatar filled in after insertion (via paintAvatar) to avoid unsafe
      // inline background-image markup with data URLs.
      const avatarHtml = '<span class="report-avatar"></span>';

      // Compact "email row" — always visible. The full detail below reveals on
      // hover / focus / tap.
      const rowHtml =
        '<div class="report-row">' +
          avatarHtml +
          '<div class="report-rowmain">' +
            '<div class="report-rowtop">' +
              '<span class="report-cat">' + escapeHtml(r.category) + flag + "</span>" +
              '<span class="report-time">' + formatTime(r.created_at) + "</span>" +
            "</div>" +
            '<div class="report-rowsub">' +
              '<span class="report-sender">' + escapeHtml(senderName) + "</span>" +
              '<span class="report-snippet">' + escapeHtml(r.description) + "</span>" +
            "</div>" +
            '<div class="report-rowbadges">' +
              '<span class="badge ' + statusClass + '">' + escapeHtml(r.status) + "</span>" +
              '<span class="prio-pill p-' + r.priority + '">' + escapeHtml(r.priority) + "</span>" +
              ackPill +
            "</div>" +
          "</div>" +
          '<span class="report-chevron" aria-hidden="true">' + svgIcon("chevron") + "</span>" +
        "</div>";

      const bodyInner =
        '<p class="report-desc">' + escapeHtml(r.description) + "</p>" +
        routeTag +
        feelingTag +
        outcomeBlock +
        ackNote +
        '<div class="report-meta"><span class="report-ref">' + refNum(r.id) +
          "</span> • " + meta.join(" • ") + "</div>";

      item.innerHTML = rowHtml + '<div class="report-body"><div class="report-body-inner">' +
        bodyInner + "</div></div>";

      // Fill the sender avatar (picture if present, else initials).
      paintAvatar(item.querySelector(".report-avatar"), r.reporter_avatar, senderInitials);

      // Tap the row to expand on touch devices (hover handles desktop).
      const rowEl = item.querySelector(".report-row");
      rowEl.addEventListener("click", function () {
        item.classList.toggle("expanded");
      });

      const bodyInnerEl = item.querySelector(".report-body-inner");
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

      bodyInnerEl.appendChild(actions);
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

  // --- Mobile hands-free voice flow ----------------------------------------
  // On phones, dictating the description on step 1 kicks off a hands-free chain:
  // after the reporter pauses we auto-fill what we heard, then walk them to any
  // missing step (location → feeling), listening on each, and finally auto-submit
  // when nothing is left to ask. Each step is prompted at most once so a silent
  // reporter is never trapped in a loop.
  let voiceFlow = false;
  let voiceFlowPrompted = { location: false, feeling: false };
  function isMobileView() {
    return !!(window.matchMedia && window.matchMedia("(max-width: 560px)").matches);
  }
  function resetVoiceFlow() {
    voiceFlow = false;
    voiceFlowPrompted = { location: false, feeling: false };
  }

  // Auto-stop: if there's no speech activity for this long, stop listening on
  // its own so the reporter doesn't have to remember to tap "Stop".
  const SILENCE_MS = 3000;
  let silenceTimer = null;

  function clearSilenceTimer() {
    if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
  }
  function resetSilenceTimer() {
    clearSilenceTimer();
    if (!listening) return;
    silenceTimer = setTimeout(function () {
      if (!listening) return;
      // Remember which field we were dictating before stopVoice resets state,
      // so the hands-free chain knows where to go next.
      const finishedTarget = voiceTarget;
      if (voiceFlow) {
        stopVoice("Got it — one moment…");
        advanceVoiceFlow(finishedTarget);
      } else {
        stopVoice("Stopped after a pause. Review your text, then submit.");
      }
    }, SILENCE_MS);
  }

  // Walk the reporter through any step they didn't cover by voice, then submit.
  // Called after a natural pause while the mobile hands-free flow is active.
  function advanceVoiceFlow(finishedTarget) {
    if (!voiceFlow) return;
    // If they were dictating the description but said nothing usable, don't
    // hijack the form — let them take over manually.
    if (finishedTarget && finishedTarget.isDescription && !descriptionEl.value.trim()) {
      resetVoiceFlow();
      return;
    }
    // Give the transcript/UI a beat to settle, then route to the next gap.
    setTimeout(function () {
      if (!voiceFlow) return;
      // Location first.
      if (!locationEl.value.trim() && !voiceFlowPrompted.location) {
        voiceFlowPrompted.location = true;
        goToStep(2);
        promptVoiceStep(VOICE_TARGETS.location, "Where is it? Say the ward or area.");
        return;
      }
      // Then feeling (only when it applies to this priority).
      if (feelingApplies() && !selectedFeeling && !voiceFlowPrompted.feeling) {
        voiceFlowPrompted.feeling = true;
        goToStep(3);
        promptVoiceStep(VOICE_TARGETS.feeling, "How did this make you feel?");
        return;
      }
      // Nothing left to ask — submit the report for them.
      resetVoiceFlow();
      submitReport();
    }, 600);
  }

  // Move to a step, show + speak a coaching cue, then start listening once the
  // spoken prompt has finished (so the mic doesn't transcribe the prompt itself).
  function promptVoiceStep(target, message, spoken) {
    setVoiceStatusFor(target, message, "active");
    speakPrompt(spoken || message, function () {
      if (!voiceFlow) return;
      startVoice(target);
    });
  }

  // Speak a short prompt aloud (text-to-speech), then run `done` when it ends.
  // Cancels any queued speech first, and always calls `done` exactly once — with
  // a timeout fallback in case the utterance's onend never fires (or TTS is
  // unavailable), so the hands-free chain can never stall.
  function speakPrompt(text, done) {
    let called = false;
    function finish() { if (called) return; called = true; if (done) done(); }
    try {
      if (window.speechSynthesis && window.SpeechSynthesisUtterance) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 1.0;
        u.onend = finish;
        u.onerror = finish;
        window.speechSynthesis.speak(u);
        setTimeout(finish, 4000); // fallback if onend is dropped
      } else {
        setTimeout(finish, 500);
      }
    } catch (e) {
      setTimeout(finish, 500);
    }
  }

  // Set a status message on a specific target (not necessarily the active one).
  function setVoiceStatusFor(target, msg, type) {
    if (!target || !target.status) return;
    target.status.textContent = msg;
    target.status.className = "voice-status" + (type ? " " + type : "");
  }

  // Voice can target either the description (step 1) or the location (step 2).
  // Only one wizard step is visible at a time, so a single recognition engine
  // is pointed at whichever field the reporter tapped "Speak" on.
  const VOICE_TARGETS = {
    description: {
      input: descriptionEl, btn: voiceBtn, label: voiceLabel,
      status: voiceStatus, isDescription: true,
      idle: "Tap “Speak” to dictate, or just type below.",
      stopped: "Stopped. Review your text, then continue.",
    },
    location: {
      input: locationEl, btn: locVoiceBtn, label: locVoiceLabel,
      status: locVoiceStatus, isDescription: false,
      idle: "Tap “Speak” to say the ward or area, or type below.",
      stopped: "Stopped. Review the location, then continue.",
    },
    // The feeling step has no text field — voice is mapped to a chip via
    // detectFeeling. A scratch `{ value }` object stands in for an input so the
    // shared onresult handler can accumulate the transcript.
    feeling: {
      input: { value: "" }, btn: feelVoiceBtn, label: feelVoiceLabel,
      status: feelVoiceStatus, isDescription: false, isFeeling: true,
      idle: "Tap “Speak” to say how you feel, or tap a chip.",
      stopped: "Stopped. Tap a chip to change it.",
    },
  };
  let voiceTarget = VOICE_TARGETS.description;

  function setVoiceStatus(msg, type) {
    voiceTarget.status.textContent = msg;
    voiceTarget.status.className = "voice-status" + (type ? " " + type : "");
  }

  if (!SpeechRecognition) {
    [voiceBtn, locVoiceBtn, feelVoiceBtn].forEach(function (b) { if (b) b.disabled = true; });
    voiceLabel.textContent = "Voice N/A";
    if (locVoiceLabel) locVoiceLabel.textContent = "Voice N/A";
    if (feelVoiceLabel) feelVoiceLabel.textContent = "Voice N/A";
    unsupportedEl.classList.remove("hidden");
    setVoiceStatus("Voice input isn't supported here — please type your report.", "");
    if (locVoiceStatus) locVoiceStatus.textContent = "Voice input isn't supported here — please type below.";
    if (feelVoiceStatus) feelVoiceStatus.textContent = "Voice input isn't supported here — please tap a chip.";
  } else {
    voiceBtn.addEventListener("click", function () { toggleVoice(VOICE_TARGETS.description); });
    if (locVoiceBtn) locVoiceBtn.addEventListener("click", function () { toggleVoice(VOICE_TARGETS.location); });
    if (feelVoiceBtn) feelVoiceBtn.addEventListener("click", function () {
      // A manual tap on the feeling mic is a deliberate action, not part of the
      // hands-free chain, so cancel any running flow first.
      resetVoiceFlow();
      // Start each manual feeling capture from a clean transcript so a prior
      // utterance can't bias detectFeeling.
      if (!listening) VOICE_TARGETS.feeling.input.value = "";
      toggleVoice(VOICE_TARGETS.feeling);
    });
  }

  // Toggle voice for a given target: stop if already listening on it, otherwise
  // start it (stopping any other target that happened to be running first).
  function toggleVoice(target) {
    if (listening) {
      const same = voiceTarget === target;
      stopVoice();
      if (!same) startVoice(target);
    } else {
      startVoice(target);
    }
  }

  function resetVoiceButton() {
    voiceTarget.btn.classList.remove("listening");
    voiceTarget.label.textContent = "Speak";
  }

  // --- Healthcare speech polishing -------------------------------------------
  // Browser speech-to-text is trained on general English, so it mangles common
  // ward vocabulary ("ward" -> "war", "obs" -> "obbs", "A and E" -> "a and e").
  // Each rule is [pattern, replacement]; patterns use \b word boundaries and the
  // "i" flag, and the replacement carries the correct clinical casing. Applied
  // only to FINAL transcript chunks so it never fights the live interim text.
  // Extend this list with any term staff report being misheard.
  const HEALTH_SPEECH_FIXES = [
    // The reported case: "ward" is very often heard as "war".
    [/\bwar\b/gi, "ward"],
    [/\bward\s+(?:of|off)\b/gi, "ward"],
    // Bed spaces: "bay" is often heard as "buy"/"bye" before a number.
    [/\b(?:buy|bye)\b(?=\s+\d)/gi, "bay"],
    // Departments / areas
    [/\ba\s*(?:and|&|n)\s*e\b/gi, "A&E"],
    [/\bay\s*and\s*e\b/gi, "A&E"],
    [/\bresus\b/gi, "Resus"],
    [/\bre\s?suss?\b/gi, "Resus"],
    [/\btheat(?:er|re)s?\b/gi, "theatre"],
    [/\bhdu\b/gi, "HDU"],
    [/\bitu\b/gi, "ITU"],
    [/\bicu\b/gi, "ICU"],
    [/\bradiology\b/gi, "Radiology"],
    // Equipment / supplies
    [/\bcanula\b/gi, "cannula"],
    [/\bcan\s*you\s*la\b/gi, "cannula"],
    [/\bcommod\b/gi, "commode"],
    [/\bhoyer\b/gi, "hoist"],
    [/\blinnen\b/gi, "linen"],
    [/\blinin\b/gi, "linen"],
    // People / roles
    [/\bporta\b/gi, "porter"],
    [/\bhca\b/gi, "HCA"],
    // Clinical shorthand
    [/\bobbs\b/gi, "obs"],
    [/\bnil\s*by\s*mouth\b/gi, "nil by mouth"],
    [/\bcrash\s*call\b/gi, "crash call"],
  ];

  function correctHealthcareSpeech(text) {
    if (!text) return text;
    let out = text;
    for (let i = 0; i < HEALTH_SPEECH_FIXES.length; i++) {
      out = out.replace(HEALTH_SPEECH_FIXES[i][0], HEALTH_SPEECH_FIXES[i][1]);
    }
    return out;
  }

  function createRecognition() {
    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-GB";

    rec.onstart = function () {
      starting = false;
      listening = true;
      voiceTarget.btn.classList.add("listening");
      voiceTarget.label.textContent = "Stop";
      setVoiceStatus("Listening... speak now.", "active");
      resetSilenceTimer();
    };
    rec.onaudiostart = function () {
      setVoiceStatus("Microphone active — speak now.", "active");
      resetSilenceTimer();
    };
    rec.onspeechstart = function () {
      setVoiceStatus("Hearing you...", "active");
      resetSilenceTimer();
    };

    rec.onresult = function (event) {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          baseText += correctHealthcareSpeech(result[0].transcript.trim()) + " ";
        } else {
          interim += result[0].transcript;
        }
      }
      voiceTarget.input.value = (baseText + interim).replace(/\s+/g, " ").trimStart();
      if (voiceTarget.isDescription) {
        handleDescriptionChange();
      } else if (voiceTarget.isFeeling) {
        // Map spoken words to a feeling chip (best keyword match). Counts as a
        // manual choice so description parsing won't later overwrite it.
        const f = detectFeeling(voiceTarget.input.value.toLowerCase());
        if (f) {
          selectedFeeling = f;
          manualFeeling = true;
          highlightFeeling(f);
        }
      } else {
        // Spoken location counts as a deliberate choice, so smart-capture
        // won't overwrite it from the description text.
        manualLocation = true;
      }
      // Any speech activity resets the 3-second silence countdown.
      resetSilenceTimer();
    };

    rec.onerror = function (event) {
      if (event.error === "no-speech") {
        setVoiceStatus("Didn't catch that — keep talking.", "active");
        return;
      }
      if (event.error === "aborted") return;

      starting = false;
      listening = false;
      clearSilenceTimer();
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

  function startVoice(target) {
    if (starting || listening) return;
    voiceTarget = target || VOICE_TARGETS.description;
    // Dictating the description on a phone begins the hands-free chain that
    // walks the reporter through any remaining steps and auto-submits.
    if (voiceTarget.isDescription && isMobileView()) {
      voiceFlow = true;
      voiceFlowPrompted = { location: false, feeling: false };
    }
    starting = true;
    baseText = voiceTarget.input.value ? voiceTarget.input.value.trim() + " " : "";
    recognition = createRecognition();
    try {
      recognition.start();
    } catch (e) {
      starting = false;
      setVoiceStatus("Could not start voice: " + e.message, "error");
    }
  }

  function stopVoice(message) {
    listening = false;
    starting = false;
    clearSilenceTimer();
    if (recognition) recognition.stop();
    resetVoiceButton();
    setVoiceStatus(message || voiceTarget.stopped, "");
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
    const whoName = report.reporter_first_name || report.reporter || "";
    const who = whoName ? " (reported by " + whoName + ")" : "";
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

  // --- Authentication gate ------------------------------------------------
  // The app is only usable once signed in. On load we ask the server who we are;
  // if that fails we show the sign-in / register screen. Reports are attributed
  // to the signed-in account, so real-time events only connect once authed.
  const authScreen = document.getElementById("authScreen");
  const topbar = document.querySelector(".topbar");
  const container = document.querySelector(".container");
  const olBody = document.getElementById("olBody");
  const sidebar = document.getElementById("sidebar");
  const sidebarToggle = document.getElementById("sidebarToggle");
  const globalSearch = document.getElementById("globalSearch");
  const userChip = document.getElementById("userChip");
  const userAvatar = document.getElementById("userAvatar");
  const bottomNav = document.getElementById("bottomNav");
  const userNameEl = document.getElementById("userName");
  const userRoleEl = document.getElementById("userRole");
  const logoutBtn = document.getElementById("logoutBtn");

  // ---------- Outlook-style shell: search + collapsible sidebar ----------
  // Collapse / expand the left folder rail (waffle button in the app bar).
  if (sidebarToggle && sidebar) {
    sidebarToggle.addEventListener("click", function () {
      sidebar.classList.toggle("collapsed");
    });
  }

  // Quick search filters the report cards in the visible list by text.
  function applySearchFilter() {
    if (!globalSearch) return;
    const raw = globalSearch.value.trim();
    const q = raw.toLowerCase();
    document.querySelectorAll(".report-list").forEach(function (list) {
      let total = 0;
      let visible = 0;
      list.querySelectorAll(".report-item").forEach(function (el) {
        total++;
        const match = !q || el.textContent.toLowerCase().indexOf(q) !== -1;
        el.classList.toggle("search-hidden", !match);
        if (match) visible++;
      });
      let empty = list.querySelector(".search-empty");
      if (q && total > 0 && visible === 0) {
        if (!empty) {
          empty = document.createElement("p");
          empty.className = "search-empty card-hint";
          list.appendChild(empty);
        }
        empty.textContent = 'No reports match “' + raw + '”.';
        empty.hidden = false;
      } else if (empty) {
        empty.hidden = true;
      }
    });
  }

  if (globalSearch) {
    globalSearch.addEventListener("input", function () {
      const q = globalSearch.value.trim();
      // Searching from the compose / profile view jumps to the report list.
      if (q && (activeView === "report" || activeView === "profile")) {
        activateView("list");
      }
      applySearchFilter();
    });
    // Re-apply the filter whenever a list re-renders (loads are async).
    ["reportList", "allList", "resolvedList"].forEach(function (id) {
      const el = document.getElementById(id);
      if (!el) return;
      new MutationObserver(function () {
        applySearchFilter();
      }).observe(el, { childList: true });
    });
  }

  const authTitle = document.getElementById("authTitle");
  const authIntro = document.getElementById("authIntro");
  const authEmail = document.getElementById("authEmail");
  const authPassword = document.getElementById("authPassword");
  const authFirstName = document.getElementById("authFirstName");
  const authLastName = document.getElementById("authLastName");
  const authProfession = document.getElementById("authProfession");
  const registerFields = document.getElementById("registerFields");
  const authSubmit = document.getElementById("authSubmit");
  const authMsg = document.getElementById("authMsg");
  const authSwitchText = document.getElementById("authSwitchText");
  const authSwitchBtn = document.getElementById("authSwitchBtn");

  let authMode = "login"; // or "register"
  let eventsConnected = false;

  function setAuthMsg(text, type) {
    authMsg.textContent = text || "";
    authMsg.className = "form-msg" + (type ? " " + type : "");
  }

  function applyAuthMode() {
    const registering = authMode === "register";
    registerFields.classList.toggle("hidden", !registering);
    authTitle.textContent = registering
      ? "Create your account"
      : "Sign in to Friction Aid";
    authIntro.textContent = registering
      ? "Set up an account so your reports are logged under your name."
      : "Reports are logged under your name so the right team can follow up.";
    authSubmit.textContent = registering ? "Create account" : "Sign in";
    authPassword.setAttribute(
      "autocomplete",
      registering ? "new-password" : "current-password"
    );
    authSwitchText.textContent = registering
      ? "Already have an account?"
      : "New here?";
    authSwitchBtn.textContent = registering ? "Sign in" : "Create an account";
    setAuthMsg("", "");
  }

  authSwitchBtn.addEventListener("click", function () {
    authMode = authMode === "login" ? "register" : "login";
    applyAuthMode();
  });

  function showAuthScreen() {
    if (topbar) topbar.classList.add("hidden");
    if (olBody) olBody.classList.add("hidden");
    userChip.classList.add("hidden");
    if (bottomNav) bottomNav.classList.add("hidden");
    if (composeFab) composeFab.classList.add("hidden");
    authScreen.classList.remove("hidden");
    authEmail.focus();
  }

  function showApp(user) {
    currentUser = user;
    applyPreferences(user);
    authScreen.classList.add("hidden");
    if (topbar) topbar.classList.remove("hidden");
    if (olBody) olBody.classList.remove("hidden");
    userNameEl.textContent = fullName(user);
    userRoleEl.textContent = user.profession || "";
    if (userAvatar) paintAvatar(userAvatar, user.avatar, initials(user));
    userChip.classList.remove("hidden");
    if (bottomNav) bottomNav.classList.remove("hidden");
    if (composeFab) composeFab.classList.remove("hidden");
    if (!eventsConnected) {
      connectEvents();
      eventsConnected = true;
    }
    reloadActiveView();
    maybeAutostartVoice();
  }

  // Auto-start voice capture on open when the user has opted in.
  let autostartTried = false;
  function maybeAutostartVoice() {
    if (autostartTried) return;
    autostartTried = true;
    if (!currentUser || !currentUser.voice_autostart) return;
    if (!SpeechRecognition) return;
    // Mic access may need a user gesture; startVoice handles errors gracefully.
    setTimeout(function () {
      try {
        startVoice();
      } catch (err) {
        /* silently ignore — user can tap the mic button */
      }
    }, 400);
  }

  // ---------- Appearance (theme colour, font size, dark mode) ----------
  // Apply a user's personalisation to the whole document. Safe to call anytime.
  function applyPreferences(user) {
    const root = document.documentElement;
    const color = (user && THEME_COLORS.indexOf(user.theme_color) >= 0)
      ? user.theme_color : "#0f6cbd";
    root.style.setProperty("--brand", color);
    root.style.setProperty("--brand-strong", color);
    const scale = (user && FONT_SCALES.indexOf(user.font_scale) >= 0)
      ? user.font_scale : "medium";
    root.style.setProperty("--base-font", FONT_SIZES[scale]);
    root.setAttribute("data-theme", user && user.dark_mode ? "dark" : "light");
  }

  // Set an avatar-style element to show either a picture or initials.
  function paintAvatar(el, dataUrl, initialsText) {
    if (!el) return;
    if (dataUrl) {
      el.style.backgroundImage = "url(" + JSON.stringify(dataUrl) + ")";
      el.classList.add("has-img");
      el.textContent = "";
    } else {
      el.style.backgroundImage = "";
      el.classList.remove("has-img");
      el.textContent = initialsText || "";
    }
  }

  // ---------- Profile & settings ----------
  function populateProfile() {
    if (!currentUser) return;
    if (profileNameEl) profileNameEl.textContent = fullName(currentUser);
    if (profileMetaEl) {
      profileMetaEl.textContent = [
        currentUser.profession,
        currentUser.alias ? "“" + currentUser.alias + "”" : null,
        currentUser.email,
        currentUser.hospital_name,
      ].filter(Boolean).join(" · ");
    }
    paintAvatar(profileAvatarEl, currentUser.avatar, initials(currentUser));
    // Edit fields
    if (editFirstName) editFirstName.value = currentUser.first_name || "";
    if (editLastName) editLastName.value = currentUser.last_name || "";
    if (editProfession) editProfession.value = currentUser.profession || "";
    if (editAlias) editAlias.value = currentUser.alias || "";
    pendingAvatar = undefined;
    paintAvatar(avatarPreview, currentUser.avatar, initials(currentUser));
    if (profileMsg) { profileMsg.textContent = ""; profileMsg.className = "form-msg"; }
    // Appearance controls
    renderThemeSwatches();
    renderFontScale();
    if (darkModeToggle) darkModeToggle.checked = !!currentUser.dark_mode;
    if (appearanceMsg) { appearanceMsg.textContent = ""; appearanceMsg.className = "form-msg"; }
    if (autostartToggle) autostartToggle.checked = !!currentUser.voice_autostart;
    if (settingsMsg) { settingsMsg.textContent = ""; settingsMsg.className = "form-msg"; }
  }

  function renderThemeSwatches() {
    if (!themeSwatches) return;
    themeSwatches.innerHTML = "";
    const current = (currentUser && currentUser.theme_color) || "#0f6cbd";
    THEME_COLORS.forEach(function (c) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "swatch" + (c === current ? " active" : "");
      b.style.background = c;
      b.setAttribute("aria-label", "Theme colour " + c);
      b.addEventListener("click", function () {
        saveAppearance({ theme_color: c });
      });
      themeSwatches.appendChild(b);
    });
  }

  function renderFontScale() {
    if (!fontScaleBtns) return;
    const current = (currentUser && currentUser.font_scale) || "medium";
    fontScaleBtns.querySelectorAll("button").forEach(function (b) {
      b.classList.toggle("active", b.dataset.scale === current);
    });
  }

  // Persist appearance changes, apply instantly, and reflect in the controls.
  function saveAppearance(changes) {
    if (appearanceMsg) { appearanceMsg.textContent = "Saving…"; appearanceMsg.className = "form-msg"; }
    fetch("/api/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changes),
    })
      .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(function (user) {
        currentUser = user;
        applyPreferences(user);
        renderThemeSwatches();
        renderFontScale();
        if (darkModeToggle) darkModeToggle.checked = !!user.dark_mode;
        if (userAvatar) paintAvatar(userAvatar, user.avatar, initials(user));
        if (appearanceMsg) { appearanceMsg.textContent = "Saved."; appearanceMsg.className = "form-msg success"; }
      })
      .catch(function () {
        if (appearanceMsg) { appearanceMsg.textContent = "Couldn't save that — please try again."; appearanceMsg.className = "form-msg error"; }
      });
  }

  if (fontScaleBtns) {
    fontScaleBtns.querySelectorAll("button").forEach(function (b) {
      b.addEventListener("click", function () {
        saveAppearance({ font_scale: b.dataset.scale });
      });
    });
  }
  if (darkModeToggle) {
    darkModeToggle.addEventListener("change", function () {
      saveAppearance({ dark_mode: darkModeToggle.checked });
    });
  }

  // Avatar picking — read the file as a data URL and preview it.
  if (avatarPickBtn && avatarInput) {
    avatarPickBtn.addEventListener("click", function () { avatarInput.click(); });
    avatarInput.addEventListener("change", function () {
      const file = avatarInput.files && avatarInput.files[0];
      if (!file) return;
      if (file.size > 1200000) {
        if (profileMsg) { profileMsg.textContent = "That image is too large (max ~1 MB)."; profileMsg.className = "form-msg error"; }
        avatarInput.value = "";
        return;
      }
      const reader = new FileReader();
      reader.onload = function () {
        pendingAvatar = String(reader.result);
        paintAvatar(avatarPreview, pendingAvatar, initials(currentUser));
        if (profileMsg) { profileMsg.textContent = "Picture ready — click Save changes."; profileMsg.className = "form-msg"; }
      };
      reader.readAsDataURL(file);
    });
  }
  if (avatarClearBtn) {
    avatarClearBtn.addEventListener("click", function () {
      pendingAvatar = null;
      paintAvatar(avatarPreview, null, initials(currentUser));
      if (profileMsg) { profileMsg.textContent = "Picture will be removed — click Save changes."; profileMsg.className = "form-msg"; }
    });
  }

  // Save profile details (name, profession, alias, avatar).
  if (profileSaveBtn) {
    profileSaveBtn.addEventListener("click", function () {
      const payload = {
        first_name: editFirstName ? editFirstName.value.trim() : "",
        last_name: editLastName ? editLastName.value.trim() : "",
        profession: editProfession ? editProfession.value.trim() : "",
        alias: editAlias ? editAlias.value.trim() : "",
      };
      if (!payload.first_name || !payload.last_name || !payload.profession) {
        if (profileMsg) { profileMsg.textContent = "First name, last name and profession are required."; profileMsg.className = "form-msg error"; }
        return;
      }
      if (pendingAvatar !== undefined) payload.avatar = pendingAvatar;
      profileSaveBtn.disabled = true;
      if (profileMsg) { profileMsg.textContent = "Saving…"; profileMsg.className = "form-msg"; }
      fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then(function (r) {
          return r.json().then(function (data) {
            if (!r.ok) throw new Error(data.error || "save failed");
            return data;
          });
        })
        .then(function (user) {
          currentUser = user;
          pendingAvatar = undefined;
          populateProfile();
          userNameEl.textContent = fullName(user);
          userRoleEl.textContent = user.profession || "";
          if (userAvatar) paintAvatar(userAvatar, user.avatar, initials(user));
          if (profileMsg) { profileMsg.textContent = "Your details are saved."; profileMsg.className = "form-msg success"; }
        })
        .catch(function (err) {
          if (profileMsg) { profileMsg.textContent = err.message || "Couldn't save — please try again."; profileMsg.className = "form-msg error"; }
        })
        .finally(function () { profileSaveBtn.disabled = false; });
    });
  }

  // ---------- Hospitals ----------
  function loadHospitals() {
    if (!hospitalsListEl) return;
    hospitalsListEl.innerHTML = '<p class="muted-note">Loading hospitals…</p>';
    fetch("/api/hospitals")
      .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(renderHospitals)
      .catch(function () {
        hospitalsListEl.innerHTML = '<p class="form-msg error">Couldn\'t load hospitals.</p>';
      });
  }

  function renderHospitals(hospitals) {
    hospitalsListEl.innerHTML = "";
    hospitals.forEach(function (h) {
      const card = document.createElement("div");
      card.className = "hospital-card" + (h.is_active ? " active" : "");

      // The server only sends a hospital's staff roster to its own members.
      // For other departments the roster is withheld (empty), so show a note.
      let staffHtml;
      if (h.staff.length) {
        staffHtml = h.staff.map(function (s) {
          const nm = escapeHtml([s.first_name, s.last_name].filter(Boolean).join(" "));
          const dot = '<span class="presence-dot ' + (s.online ? "on" : "off") + '"></span>';
          return '<li>' + dot + '<span class="staff-name">' + nm + "</span>" +
            '<span class="staff-role">' + escapeHtml(s.profession || "") + "</span></li>";
        }).join("");
      } else if (!h.is_active) {
        staffHtml =
          '<li class="muted-note">Staff are only visible to this department. Switch here to see who works here.</li>';
      } else {
        staffHtml = '<li class="muted-note">No staff yet.</li>';
      }

      // Count of who works here (server sends the true count even when the
      // roster itself is hidden).
      const staffCount = typeof h.staff_count === "number" ? h.staff_count : h.staff.length;

      const badges =
        (h.is_home ? '<span class="hospital-badge home">Your hospital</span>' : "") +
        (h.is_active ? '<span class="hospital-badge active">Active department</span>' : "");

      let switchHtml = "";
      if (!h.is_active) {
        switchHtml =
          '<div class="hospital-switch">' +
            '<p class="pw-hint">Password to enter this department: <code>' + escapeHtml(h.password) + "</code></p>" +
            '<div class="pw-row">' +
              '<input type="password" class="hospital-pw" placeholder="Enter password" />' +
              '<button class="primary-btn hospital-switch-btn" type="button">Switch here</button>' +
            "</div>" +
            '<p class="hospital-msg form-msg"></p>' +
          "</div>";
      }

      card.innerHTML =
        '<div class="hospital-head">' +
          '<h3 class="hospital-name">' + escapeHtml(h.name) + "</h3>" +
          '<span class="hospital-badges">' + badges + "</span>" +
        "</div>" +
        '<p class="hospital-count">' + staffCount + " staff member" +
          (staffCount === 1 ? "" : "s") + "</p>" +
        '<ul class="hospital-staff">' + staffHtml + "</ul>" +
        switchHtml;

      if (!h.is_active) {
        const btn = card.querySelector(".hospital-switch-btn");
        const pw = card.querySelector(".hospital-pw");
        const msg = card.querySelector(".hospital-msg");
        const doSwitch = function () {
          btn.disabled = true;
          msg.textContent = "Switching…"; msg.className = "hospital-msg form-msg";
          fetch("/api/hospitals/" + h.id + "/switch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: pw.value }),
          })
            .then(function (r) {
              return r.json().then(function (data) {
                if (!r.ok) throw new Error(data.error || "Switch failed");
                return data;
              });
            })
            .then(function () {
              msg.textContent = "Switched — you're now in " + h.name + ".";
              msg.className = "hospital-msg form-msg success";
              loadHospitals();
            })
            .catch(function (err) {
              msg.textContent = err.message || "Couldn't switch.";
              msg.className = "hospital-msg form-msg error";
              btn.disabled = false;
            });
        };
        btn.addEventListener("click", doSwitch);
        pw.addEventListener("keydown", function (e) { if (e.key === "Enter") doSwitch(); });
      }

      hospitalsListEl.appendChild(card);
    });
  }

  // ---------- Staff online (real presence) ----------
  function loadStaff() {
    if (!staffListEl) return;
    staffListEl.innerHTML = '<p class="muted-note">Loading…</p>';
    fetch("/api/staff")
      .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(renderStaff)
      .catch(function () {
        staffListEl.innerHTML = '<p class="form-msg error">Couldn\'t load staff.</p>';
      });
  }

  function renderStaff(staff) {
    if (!staff.length) {
      staffListEl.innerHTML = '<p class="muted-note">Nobody else is online right now.</p>';
      return;
    }
    staffListEl.innerHTML = "";
    staff.forEach(function (s) {
      const row = document.createElement("div");
      row.className = "staff-card";
      const nm = [s.first_name, s.last_name].filter(Boolean).join(" ");
      const av = document.createElement("span");
      av.className = "report-avatar";
      paintAvatar(av, s.avatar, ((s.first_name || " ")[0] + (s.last_name || " ")[0]).toUpperCase());
      row.appendChild(av);
      const info = document.createElement("div");
      info.className = "staff-info";
      info.innerHTML =
        '<span class="staff-name">' + escapeHtml(nm) +
          (s.is_me ? ' <span class="you-tag">you</span>' : "") + "</span>" +
        '<span class="staff-role">' + escapeHtml(s.profession || "") +
          (s.hospital_name ? " · " + escapeHtml(s.hospital_name) : "") + "</span>";
      row.appendChild(info);
      const dot = document.createElement("span");
      dot.className = "presence-dot on";
      row.appendChild(dot);
      staffListEl.appendChild(row);
    });
  }

  if (staffRefreshBtn) {
    staffRefreshBtn.addEventListener("click", loadStaff);
  }

  if (settingsBtn) {
    settingsBtn.addEventListener("click", function () {
      activateView("profile");
    });
  }
  if (profileBackBtn) {
    profileBackBtn.addEventListener("click", function () {
      activateView("report");
    });
  }
  if (autostartToggle) {
    autostartToggle.addEventListener("change", function () {
      const wanted = autostartToggle.checked;
      autostartToggle.disabled = true;
      if (settingsMsg) { settingsMsg.textContent = "Saving…"; settingsMsg.className = "form-msg"; }
      fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice_autostart: wanted }),
      })
        .then(function (r) {
          if (!r.ok) throw new Error("save failed");
          return r.json();
        })
        .then(function (user) {
          currentUser = user;
          autostartToggle.checked = !!user.voice_autostart;
          if (settingsMsg) {
            settingsMsg.textContent = wanted
              ? "Voice will start automatically next time you open the app."
              : "Auto-start turned off.";
            settingsMsg.className = "form-msg success";
          }
        })
        .catch(function () {
          autostartToggle.checked = !wanted;
          if (settingsMsg) {
            settingsMsg.textContent = "Couldn't save that — please try again.";
            settingsMsg.className = "form-msg error";
          }
        })
        .finally(function () {
          autostartToggle.disabled = false;
        });
    });
  }

  // ---------- AI assistant ("Talk it through") ----------
  const assistHistory = [];
  let assistBusy = false;

  function addAssistBubble(text, who) {
    const b = document.createElement("div");
    b.className = "assist-bubble " + who;
    b.textContent = text;
    assistMessages.appendChild(b);
    assistMessages.scrollTop = assistMessages.scrollHeight;
    return b;
  }

  function setAssistTyping(on) {
    let el = assistMessages.querySelector(".assist-bubble.typing");
    if (on) {
      if (!el) addAssistBubble("Thinking…", "assistant typing");
    } else if (el) {
      el.remove();
    }
  }

  function openAssist() {
    if (!descriptionEl.value.trim()) {
      showDescPrompt();
      descriptionEl.focus();
      return;
    }
    assistMessages.classList.remove("hidden");
    assistInputRow.classList.remove("hidden");
    assistStart.classList.add("hidden");
    assistInput.focus();
    if (assistHistory.length === 0) sendAssist("");
  }

  // Apply the assistant's extracted fields, but never clobber a choice the
  // reporter made by hand (tracked via the same manual* flags as smart capture).
  function applyExtracted(ex) {
    if (!ex || typeof ex !== "object") return;
    if (ex.category && !manualCategory) {
      applyCategory(ex.category, true);
    }
    if (ex.priority && ex.priority !== "Emergency" && !manualPriority) {
      setPriority(ex.priority);
      manualPriority = true;
    }
    if (ex.feeling && !manualFeeling) {
      selectedFeeling = ex.feeling;
      highlightFeeling(ex.feeling);
      manualFeeling = true;
    }
    if (ex.location && !manualLocation && !locationEl.value.trim()) {
      locationEl.value = ex.location;
      manualLocation = true;
    }
  }

  // Clear the assistant chat back to its idle state (called from resetForm).
  function resetAssist() {
    assistHistory.length = 0;
    assistBusy = false;
    if (assistMessages) {
      assistMessages.innerHTML = "";
      assistMessages.classList.add("hidden");
    }
    if (assistInputRow) assistInputRow.classList.add("hidden");
    if (assistInput) assistInput.value = "";
    if (assistSend) assistSend.disabled = false;
    if (assistStart) assistStart.classList.remove("hidden");
  }

  function sendAssist(userText) {
    if (assistBusy) return;
    assistBusy = true;
    assistSend.disabled = true;
    if (userText) {
      addAssistBubble(userText, "user");
      assistHistory.push({ role: "user", content: userText });
    }
    setAssistTyping(true);
    fetch("/api/assist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: assistHistory,
        description: descriptionEl.value.trim(),
        fields: {
          category: selectedCategory || "",
          location: locationEl.value.trim(),
          priority: selectedPriority || "",
          feeling: selectedFeeling || "",
        },
      }),
    })
      .then(function (r) {
        if (r.status === 503) throw new Error("unavailable");
        if (!r.ok) throw new Error("assist failed");
        return r.json();
      })
      .then(function (data) {
        setAssistTyping(false);
        if (data.reply) {
          addAssistBubble(data.reply, "assistant");
          assistHistory.push({ role: "assistant", content: data.reply });
        }
        applyExtracted(data.extracted);
        if (data.complete) {
          assistInputRow.classList.add("hidden");
          addAssistBubble(
            "All set — I've filled in the form below. Review it and submit when you're ready.",
            "assistant"
          );
        }
      })
      .catch(function (err) {
        setAssistTyping(false);
        const msg =
          err && err.message === "unavailable"
            ? "The assistant isn't available right now — just fill in the form below yourself."
            : "Sorry, something went wrong. You can keep filling in the form manually.";
        addAssistBubble(msg, "assistant");
      })
      .finally(function () {
        assistBusy = false;
        assistSend.disabled = false;
      });
  }

  function submitAssist() {
    const text = assistInput.value.trim();
    if (!text || assistBusy) return;
    assistInput.value = "";
    sendAssist(text);
  }

  if (assistStart) assistStart.addEventListener("click", openAssist);
  if (assistSend) assistSend.addEventListener("click", submitAssist);
  if (assistInput) {
    assistInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") submitAssist();
    });
  }

  function fullName(user) {
    const name = [user.first_name, user.last_name]
      .filter(Boolean)
      .join(" ")
      .trim();
    return name || user.email || "You";
  }

  // Two-letter initials for the app-bar avatar (Outlook-style).
  function initials(user) {
    const a = (user.first_name || "").trim();
    const b = (user.last_name || "").trim();
    if (a || b) return ((a[0] || "") + (b[0] || "")).toUpperCase();
    const e = (user.email || "").trim();
    return (e[0] || "?").toUpperCase();
  }

  authSubmit.addEventListener("click", submitAuth);
  [authEmail, authPassword, authFirstName, authLastName, authProfession].forEach(
    function (el) {
      if (!el) return;
      el.addEventListener("keydown", function (e) {
        if (e.key === "Enter") submitAuth();
      });
    }
  );

  function submitAuth() {
    const registering = authMode === "register";
    const payload = {
      email: authEmail.value.trim(),
      password: authPassword.value,
    };
    if (registering) {
      payload.first_name = authFirstName.value.trim();
      payload.last_name = authLastName.value.trim();
      payload.profession = authProfession.value.trim();
    }
    authSubmit.disabled = true;
    setAuthMsg(registering ? "Creating account…" : "Signing in…", "");

    fetch(registering ? "/api/register" : "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (r) {
        if (!r.ok) throw new Error(r.data.error || "Something went wrong.");
        authPassword.value = "";
        setAuthMsg("", "");
        showApp(r.data);
      })
      .catch(function (err) {
        setAuthMsg(err.message, "error");
      })
      .finally(function () {
        authSubmit.disabled = false;
      });
  }

  function doLogout() {
    fetch("/api/logout", { method: "POST" }).finally(function () {
      window.location.reload();
    });
  }
  logoutBtn.addEventListener("click", doLogout);
  const profileLogoutBtn = document.getElementById("profileLogoutBtn");
  if (profileLogoutBtn) profileLogoutBtn.addEventListener("click", doLogout);

  // On load: are we already signed in?
  fetch("/api/me")
    .then(function (res) {
      if (!res.ok) throw new Error("not signed in");
      return res.json();
    })
    .then(function (user) {
      showApp(user);
    })
    .catch(function () {
      applyAuthMode();
      showAuthScreen();
    });
})();
