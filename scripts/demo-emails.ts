import type { RawEmail } from "../src/lib/classify";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

/** Realistic sample emails used by `npm run demo` and the tests. */
export function demoEmails(): RawEmail[] {
  return [
    {
      gmailId: "demo-netflix-1",
      threadId: "t-netflix-1",
      subject: "Thank you for applying to Netflix",
      sender: "Netflix Recruiting <no-reply@netflix.com>",
      date: daysAgo(30),
      body: "Hi there,\n\nThank you for applying to Netflix for the Software Engineer Intern, Summer 2027 position. We have received your application and our team is reviewing it.\n\nBest,\nNetflix Recruiting",
    },
    {
      gmailId: "demo-netflix-2",
      threadId: "t-netflix-2",
      subject: "One more step for your Netflix application",
      sender: "Netflix University Recruiting <university@netflix.com>",
      date: daysAgo(20),
      body: `Hi there,\n\nIf you applied to one of our internship roles, you still need to complete the candidate questionnaire before we can review your application: https://jobs.netflix.com/candidate-form?id=8812\n\nPlease complete it by ${inDays(3)}.\n\nThanks,\nNetflix`,
    },
    {
      gmailId: "demo-google-1",
      threadId: "t-google-1",
      subject: "Thank you for your application to Google",
      sender: "Google Careers <careers-noreply@google.com>",
      date: daysAgo(40),
      body: "Thank you for your interest in Google. We have received your application for the Software Engineering Intern, BS, Summer 2027 role.",
    },
    {
      gmailId: "demo-google-2",
      threadId: "t-google-2",
      subject: "Google Online Assessment - Software Engineering Intern",
      sender: "Google Staffing <staffing-noreply@google.com>",
      date: daysAgo(12),
      body: `Congratulations! You've been selected to take the next step: an online assessment for the Software Engineering Intern, BS, Summer 2027 role.\n\nComplete the assessment here: https://www.hackerrank.com/test/google-swe-intern-2027\n\nPlease complete it by ${inDays(2)}.`,
    },
    {
      gmailId: "demo-google-3",
      threadId: "t-google-3",
      subject: "Google interview: please share your availability",
      sender: "Google Recruiting <recruiting-noreply@google.com>",
      date: daysAgo(2),
      body: "Great work on the assessment! We'd like to invite you to a technical interview for the Software Engineering Intern role. Please schedule a time using this link: https://calendar.app.google/schedule-abc123",
    },
    {
      gmailId: "demo-janestreet-1",
      threadId: "t-js-1",
      subject: "Your application to Jane Street",
      sender: "Jane Street <noreply@greenhouse.io>",
      date: daysAgo(35),
      body: "Thank you for applying to Jane Street. We have received your application for the Software Engineer Intern position.",
    },
    {
      gmailId: "demo-janestreet-2",
      threadId: "t-js-1",
      subject: "Re: Your application to Jane Street",
      sender: "Jane Street <noreply@greenhouse.io>",
      date: daysAgo(9),
      body: "Thank you for your interest. Unfortunately, we have decided not to move forward with your application at this time. We wish you the best in your search.",
    },
    {
      gmailId: "demo-stripe-1",
      threadId: "t-stripe-1",
      subject: "Application received: Software Engineer Intern",
      sender: "Stripe <no-reply@stripe.com>",
      date: daysAgo(28),
      body: "Thanks for applying to Stripe! Your application for Software Engineer Intern has been received.",
    },
    {
      gmailId: "demo-datadog-1",
      threadId: "t-dd-1",
      subject: "Thank you for applying!",
      sender: "Datadog Careers <careers@datadoghq.com>",
      date: daysAgo(6),
      body: "Thank you for applying to Datadog for the Software Engineering Intern role. We'll be in touch.",
    },
    {
      gmailId: "demo-alert-1",
      threadId: "t-alert-1",
      subject: "30 new jobs you may like",
      sender: "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>",
      date: daysAgo(1),
      body: "Jobs you may like: Software Engineer Intern at Meta, Data Analyst at Amazon... Unsubscribe from job alerts.",
    },
    {
      gmailId: "demo-vague-1",
      threadId: "t-vague-1",
      subject: "Update on your candidacy",
      sender: "Talent Team <talent@notify.recruitingcloud.io>",
      date: daysAgo(4),
      body: "We wanted to share a quick update on your candidacy. Our team will reach out soon.",
    },
  ];
}
