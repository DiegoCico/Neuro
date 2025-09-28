# Neuro 🚀

A professional networking platform designed to go beyond static resumes and create a more dynamic, intelligent, and engaging environment for connecting people, showcasing projects, and enabling recruiters to discover talent more effectively.

---

## Inspiration 💡

Traditional networking platforms can feel rigid and transactional. We envisioned a modern alternative that makes it easier to showcase professional achievements, integrate directly with developer tools, and leverage AI and face recognition for smarter interactions at both digital and physical career events.

---

## What it does

* **Profile Management:** Editable profiles with sections for title, bio, current focus, and beyond‑work interests.
* **GitHub Integration:** Secure login with GitHub to display up to five of a user’s most recent repositories.
* **Experience Section:** Structured, scrollable timelines to add, update, and remove professional experiences.
* **Outreach Automation:** A visual builder for creating messaging flows with targeting, scheduling, and branching.
* **Network Visualization:** Interactive canvas with occupations and interests as nodes showing connections.
* **AI Assistance:** AI‑powered suggestions to draft messages and provide recruiter insights.
* **Face Recognition Enrollment:** Guided face enrollment for event attendance verification and engagement tracking.
* **Messaging System with AI:** Built‑in messaging enhanced by AI that suggests replies and helps maintain meaningful conversations.

---

## How we built it 🛠️

We combined a **React/TypeScript front end** with a **Flask API back end.** Firebase Authentication and Firestore handle user data. GitHub OAuth provides project integration. Face recognition uses Mediapipe FaceMesh and Webcam APIs. Automation and visualization rely on custom React components and canvas‑based rendering. For AI integration, we used Google Gemini 2.5 Flash Pro as our LLM to power messaging suggestions and recruiter assistance.

---

## Challenges we ran into

* Designing an intuitive face recognition process with multiple poses.
* Balancing interactivity with performance in visualizations.
* Building automation that is powerful yet user‑friendly.

---

## Accomplishments that we're proud of 🏆

* Seamlessly integrating GitHub repos into profiles.
* Delivering a reliable face recognition enrollment system.
* Building a professional UI with real‑time editing.
* Designing a flexible automation builder that scales.

---

## What we learned 📚

* Best practices for integrating third‑party APIs securely.
* Importance of clear user flows for all audiences.
* Strategies for managing sensitive data and biometrics.

---

## What's next for Neuro 🔮

* Extend GitHub integration to pinned projects & graphs.
* Expand recruiter tools with Google ADK & A2A.
* Deploy real‑time attendee recognition at events.
* Enhance automation with templates & advanced branching.
* Add integrations with LinkedIn, Google Calendar, Slack.
* Refine AI recruiter assistance for smarter matching.
