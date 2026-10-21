# GraceHush

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Platform: Mobile](https://img.shields.io/badge/Platform-iOS%20%7C%20Android-green.svg)
![Build: Passing](https://img.shields.io/badge/Build-Passing-brightgreen.svg)

GraceHush is a mobile application created to cultivate intentional quiet time, daily reflection, and mindfulness. It provides users with a serene, distraction-free environment to record personal journals, meditate on spiritual affirmations, and track daily reflections.

---

## 📌 Project Overview

In a fast-paced digital environment, GraceHush offers a calm space for contemplative habits. The application emphasizes clean visual design, low cognitive friction, and robust local/cloud data persistence.

### Key Features
* **Daily Journaling:** Private entries with local persistence and encrypted remote backup.
* **Curated Reflections & Affirmations:** Daily scripture verses, thoughtful prompts, and devotional cards.
* **Habit & Streak Tracking:** Visual indicators to encourage consistent devotional and reflective routines.
* **Distraction-Free UI:** Minimalist typography, dark mode support, and smooth screen transitions.

---

## 🛠 Tech Stack

| Category | Technology |
| :--- | :--- |
| **Framework** | React Native / Expo |
| **Routing / Navigation** | Expo Router |
| **Styling** | NativeWind / Tailwind CSS |
| **State & Storage** | React Context / Zustand, AsyncStorage |
| **Backend & Auth** | Supabase / Clerk (or Firebase) |
| **Language** | TypeScript / JavaScript |



## 📁 Repository Structure


├── app/                  # App routes, screens, and layout definitions (Expo Router)
├── assets/               # Images, fonts, and icon sets
├── components/           # Reusable UI elements (Buttons, Cards, Modals)
├── constants/            # Theme tokens, typography, and configuration values
├── hooks/                # Custom React hooks
├── services/             # Backend clients, API routing, and storage adapters
├── .env.example          # Sample environment variable definitions
├── app.json              # Expo application manifest
├── package.json          # Package dependencies and scripts
└── README.md             # Project documentation


## 🚀 Getting Started

Follow these steps to run GraceHush locally in your development environment.

### Prerequisites

* [Node.js](https://nodejs.org/) (v18.x or later)
* [Git](https://git-scm.com/)
* [Expo Go](https://expo.dev/go) installed on your physical mobile device, or a configured iOS Simulator / Android Emulator.

### Installation & Setup

1. **Clone the repository:**

git clone [https://github.com/danieldazong/gracehush-app.git](https://github.com/danieldazong/gracehush-app.git)
cd gracehush-app




2. **Install project dependencies:**

npm install
# or
yarn install



3. **Configure Environment Variables:**
Copy the example environment configuration file to create your local `.env`:

cp .env.example .env




> **Security Notice:** Never commit actual API keys, service credentials, or production tokens to source control. Populate `.env` with placeholder/sandbox keys only.


4. **Start the development server:**

npx expo start



5. **Run on a device or emulator:**
* Scan the terminal QR code with the **Expo Go** app (Android) or the default Camera app (iOS).
* Press `a` in the terminal to launch on an Android Emulator.
* Press `i` in the terminal to launch on an iOS Simulator.



---

## 🔒 Security & Environment Configuration

Ensure your `.gitignore` contains the following entries to prevent accidental credential leaks:

gitignore
# Environment files
.env
.env.local
.env.*.local

# Keystores & release certificates
*.jks
*.p8
*.p12
*.key
*.mobileprovision

## 📬 Contact & Contributions

* **Author:** Daniel Dazong
* **GitHub:** [@danieldazong](https://www.google.com/search?q=https://github.com/danieldazong)

 
## 📬 Contact & Connect

* **Developer:** Daniel Dazong
* **LinkedIn:** https://www.linkedin.com/in/danieldazong
* **GitHub:** https://github.com/danieldazong
* **Email:** danieldazong08@gmail.com
