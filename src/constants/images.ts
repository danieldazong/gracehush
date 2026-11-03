import appleLogo from "@/assets/images/apple-logo.svg";
import googleG from "@/assets/images/google-g.svg";
import logoMarkLight from "@/assets/images/logo-mark-light.png";
import logoMark from "@/assets/images/logo-mark.png";
import onboardingScene1 from "@/assets/images/onboarding-scene-1.jpg";
import onboardingScene2 from "@/assets/images/onboarding-scene-2.jpg";
import onboardingScene3 from "@/assets/images/onboarding-scene-3.jpg";
import onboardingScene4 from "@/assets/images/onboarding-scene-4.jpg";
import onboardingScene5 from "@/assets/images/onboarding-scene-5.jpg";
import playerSceneSquare1 from "@/assets/images/player-scene-1-square.jpg";
import playerScene1 from "@/assets/images/player-scene-1.jpg";
import playerSceneSquare2 from "@/assets/images/player-scene-2-square.jpg";
import playerScene2 from "@/assets/images/player-scene-2.jpg";
import playerSceneSquare3 from "@/assets/images/player-scene-3-square.jpg";
import playerScene3 from "@/assets/images/player-scene-3.jpg";
import playerSceneSquare4 from "@/assets/images/player-scene-4-square.jpg";
import playerScene4 from "@/assets/images/player-scene-4.jpg";
import signInScene1 from "@/assets/images/sign-in-scene-1.jpg";
import signInScene2 from "@/assets/images/sign-in-scene-2.jpg";
import signInScene3 from "@/assets/images/sign-in-scene-3.jpg";
import signInScene4 from "@/assets/images/sign-in-scene-4.jpg";

export const images = {
  // The brand mark (a flame over open hands): plum and rose on transparency, for light surfaces; and its light
  // form, white and rose, for the brand gradient and plum surfaces. Both carry the mark at 72% of a 456 px square.
  logoMark,
  logoMarkLight,
  googleG,
  appleLogo,
  // The player's four painted scenes (2026-11-02, the user's call: until then the artwork was the brand gradient with the
  // logo mark in a frosted tile, built in code): a person alone with God in an ordinary place, two women and two men of
  // different ages and backgrounds, numbered in the day's order: a woman in her thirties kneeling at her bed at night, a
  // man in his forties on his back steps at first light, a woman in her sixties in an armchair by a window in the morning,
  // a man in his twenties on a park bench in the afternoon. Each comes twice from the same source: a 4:3 crop at the
  // picture's full height (1290 by 968) for the Now Playing card, and a square crop around the person (1024 by 1024) for
  // the lock screen and Control Center. The card opens on the scene of the hour (`getPlayerSceneForHour`), which is also
  // the lock screen's, and drifts through the four while the voice is heard.
  playerScene1,
  playerScene2,
  playerScene3,
  playerScene4,
  playerSceneSquare1,
  playerSceneSquare2,
  playerSceneSquare3,
  playerSceneSquare4,
  // The Welcome step's five painted scenes (2026-11-01), numbered in the order they rotate: a woman in the car at dawn, a
  // man in his fifties at his office desk at the end of the afternoon, a woman on a walk at golden hour, a man at the
  // kitchen table before dawn, and a woman late at night by a window (three women and two men, so the app never reads as
  // women-only). Illustrations the user generated to one style block, cropped to 4:5 and sized 1290 by 1612 (3x of the
  // widest iPhone); the first is the one a quick tap sees, and a hesitating visitor sees a man within seven seconds.
  onboardingScene1,
  onboardingScene2,
  onboardingScene3,
  onboardingScene4,
  onboardingScene5,
  // The cover of the Sign In that ends onboarding (2026-11-01): four more moments, none of them the Welcome's, so the
  // story goes on at the gate: a father on the hallway floor outside his child's door at night, a nurse on the hospital
  // bench after a night shift at first light, a man on the last bus home, and a woman alone in a church pew on a weekday
  // morning (two men and two women, in their forties, twenties, twenties and sixties). Cropped to 4:3 and sized 1290 by
  // 968, because that scene is shorter; the screen draws their order once per launch.
  signInScene1,
  signInScene2,
  signInScene3,
  signInScene4,
};

export const onboardingScenes = [
  onboardingScene1,
  onboardingScene2,
  onboardingScene3,
  onboardingScene4,
  onboardingScene5,
] as const;

export const signInScenes = [signInScene1, signInScene2, signInScene3, signInScene4] as const;

// The same four scenes in the day's order: the card's 4:3 crops and the lock screen's square crops.
export const playerScenes = [playerScene1, playerScene2, playerScene3, playerScene4] as const;
export const playerSceneSquares = [
  playerSceneSquare1,
  playerSceneSquare2,
  playerSceneSquare3,
  playerSceneSquare4,
] as const;
