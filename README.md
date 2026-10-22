# GraceHush

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Status: Production](https://img.shields.io/badge/Status-Production-success.svg)

A modern, responsive mobile journaling and meditation application engineered to cultivate quiet time, personal reflection, and spiritual mindfulness. Designed with a clean user experience, distraction-free typography, and optimized cross-platform performance.



## 📌 Project Overview
This repository contains the complete source code and assets for the GraceHush mobile application. The objective of this project is to provide users, project managers, and prospective stakeholders with a calm digital space to track devotional habits, meditate on curated scripture and affirmations, and record private reflections securely.

### Key Highlights
- **Responsive Layout:** Adaptive design tested across iOS and Android mobile and tablet viewports.
- **Thoughtful Features:** Interactive daily reflection cards, guided affirmations, streak tracking, and private journal logs.
- **Performance Focused:** Minimalist asset bundling, fast startup times, and smooth gesture-driven screen transitions.
- **Structured Information Architecture:** Clear separation between daily feeds, devotional libraries, user profile settings, and persistent journal entries.



## 🛠 Tech Stack

| Category | Technology |
| :--- | :--- |
| **Framework** | React Native / Expo |
| **Routing / Navigation** | Expo Router |
| **Styling** | NativeWind / Tailwind CSS |
| **State & Storage** | Zustand / React Context, AsyncStorage |
| **Backend & Services** | Supabase (or RESTful API) |
| **Version Control** | Git & GitHub |



## 📁 Repository Structure

```text
├── assets/          # Static assets (icons, brand artwork, background audio, typography)
├── components/      # Modular UI components (ReflectionCard, AudioPlayer, AffirmationModal)
├── styles/          # Global theme tokens, typography rules, and NativeWind configs
├── app/             # Application entry points, tab layouts, and navigation screens
├── README.md        # Project documentation and setup guidelines
└── package.json     # Project dependencies, build scripts, and metadata

```

## 🚀 Getting Started

Follow these instructions to run a copy of the project locally for development or testing purposes.

### Prerequisites

* A modern web browser or mobile emulator (iOS Simulator / Android Emulator)
* [Node.js](https://nodejs.org/) installed (v18.x or later recommended, if using package managers)
* [Git](https://git-scm.com/) installed on your local machine
* [Expo Go](https://expo.dev/go) app installed on your physical mobile device

### Installation & Local Setup

1. **Clone the repository:**

git clone https://github.com/danieldazong/gracehush.git
cd gracehush

2. **Install dependencies** *(if using an npm-based project)*:

npm install

3. **Run the local development server:**

npx expo start

*Scan the terminal QR code using Expo Go (Android) or the Camera app (iOS), or press `a` for Android Emulator / `i` for iOS Simulator.*

4. **Build for production:**

npx eas build --platform all

## 📬 Contact & Connect

* **Developer:** Daniel Dazong
* **LinkedIn:** https://www.linkedin.com/in/danieldazong
* **GitHub:** https://github.com/danieldazong
* **Email:** danieldazong08@gmail.com

```

```
