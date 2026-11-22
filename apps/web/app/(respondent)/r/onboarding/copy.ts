export const onboardingCopy = {
  pageTitle: "Profile and privacy choices",
  loadFailed: "Your choices couldn’t load. Refresh this page and try again.",
  signInAgain: "Your session expired. Sign in again before saving.",
  saveFailed: "Your changes couldn’t be saved. Try again.",
  saving: "Saving…",
  profile: {
    heading: "Find studies that fit",
    introduction: "Your answers help match you with relevant studies.",
    submit: "Save and continue",
    invalid: "Answer each question and pick 2 or 3 interests.",
    ageRange: "What’s your age range?",
    gender: "How do you describe your gender?",
    studentYear: "Are you currently in school?",
    campus: "Do you live on campus?",
    zip: "What’s your ZIP code?",
    foodOrders: "How many times do you order food in a typical week?",
    shopping: "How often do you shop online?",
    interests: "Which topics interest you?",
    interestHint: "Pick 2 or 3.",
    select: "Choose an answer",
  },
  consent: {
    heading: "Choose what to share",
    introduction: "Each choice is optional. You can type answers when voice access is off.",
    details: "Read the preview consent details",
    detailsText: "These choices describe how the test study uses the answers you provide. Raw voice clips are private in this preview. Allowing researcher access applies to transcripts after identifying details are removed.",
    submit: "Save privacy choices",
    back: "Back to profile",
    version: "Preview consent v1",
  },
  complete: {
    heading: "Your account is ready",
    introduction: "Your profile and privacy choices are saved.",
    profile: "Review profile",
    consent: "Review privacy choices",
    home: "Back to your account",
  },
};

export const profileChoices = {
  age_range: [
    ["18-24", "18 to 24"], ["25-34", "25 to 34"], ["35-44", "35 to 44"],
    ["45-54", "45 to 54"], ["55-64", "55 to 64"], ["65+", "65 or older"],
  ],
  gender: [
    ["woman", "Woman"], ["man", "Man"], ["nonbinary", "Nonbinary"],
    ["another", "Another gender"], ["undisclosed", "Prefer not to say"],
  ],
  student_year: [
    ["not_student", "No"], ["year_1", "Yes, first year"], ["year_2", "Yes, second year"],
    ["year_3", "Yes, third year"], ["year_4_plus", "Yes, fourth year or later"],
    ["graduate", "Yes, graduate student"], ["other", "Yes, another program"],
  ],
  online_shopping_frequency: [
    ["less_than_monthly", "Less than once a month"], ["monthly", "About once a month"],
    ["weekly", "About once a week"], ["several_per_week", "Several times a week"], ["never", "Never"],
  ],
  interests: [
    ["food", "Food and drink"], ["shopping", "Shopping"], ["campus", "Student life"],
    ["technology", "Technology"], ["travel", "Travel"], ["media", "Games and media"],
  ],
} as const;

export const consentChoices = [
  { purpose: "recording", title: "Record my voice answers", details: "Envoi can record when you tap to speak." },
  { purpose: "transcription_vendor", title: "Turn my voice answers into text", details: "Envoi can send recordings to a speech-to-text provider." },
  { purpose: "retention", title: "Keep my study answers", details: "Envoi can keep answers for research and quality review." },
  { purpose: "researcher_access", title: "Share my redacted answers with researchers", details: "Researchers can read transcripts after identifying details are removed." },
] as const;
