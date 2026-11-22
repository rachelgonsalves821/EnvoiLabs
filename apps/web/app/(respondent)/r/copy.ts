export const respondentCopy = {
  title: "Your interviews",
  instruction: "Open a study invitation to get started.",
  signup: "Sign in or get started",
  help: "How interviews work",
  helpIntro: "An invitation takes you to the study it was sent for.",
  helpDetail: "During the interview, you’ll see one question at a time. You can speak or type your answers.",
};

export const homeCopy = {
  title: "Your studies",
  profile: "Profile and privacy choices",
  emptyTitle: "No study invitations yet",
  emptyDescription: "New invitations appear here when a study matches your profile.",
  loadError: "Your studies couldn’t load. Refresh this page and try again.",
  topic: "Research interview",
  privacy: "Research teams can only see redacted answers.",
  matched: "Your profile matches this study.",
  screening: "A few screening questions are needed to check your fit.",
  screeningBadge: "Screening needed",
  acceptedBadge: "Accepted",
  progressBadge: "In progress",
  rewardLabel: "Interview reward",
  timeLeft: (minutes: number) => minutes < 60 ? `Ends in ${minutes} min` : `Ends in ${Math.ceil(minutes / 60)} h`,
  duration: (minutes: number) => `${minutes} min`,
  questionCount: (count: number) => `${count} ${count === 1 ? "question" : "questions"}`,
};
