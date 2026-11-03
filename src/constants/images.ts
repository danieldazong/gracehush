import appleLogo from "@/assets/images/apple-logo.svg";
import googleG from "@/assets/images/google-g.svg";
import logoMarkLight from "@/assets/images/logo-mark-light.png";
import logoMark from "@/assets/images/logo-mark.png";
import onboardingScene1 from "@/assets/images/onboarding-scene-1.jpg";
import onboardingScene2 from "@/assets/images/onboarding-scene-2.jpg";
import onboardingScene3 from "@/assets/images/onboarding-scene-3.jpg";
import onboardingScene4 from "@/assets/images/onboarding-scene-4.jpg";
import onboardingScene5 from "@/assets/images/onboarding-scene-5.jpg";
import playerArtwork from "@/assets/images/player-artwork.png";

export const images = {
  // The brand mark (a flame over open hands): plum and rose on transparency, for light surfaces; and its light
  // form, white and rose, for the brand gradient and plum surfaces. Both carry the mark at 72% of a 456 px square.
  logoMark,
  logoMarkLight,
  googleG,
  appleLogo,
  // The lock-screen and notification picture of a devotional (step 26): the Now Playing gradient with the logo mark in its
  // frosted tile, 1024 by 1024, no text.
  playerArtwork,
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
};

export const onboardingScenes = [
  onboardingScene1,
  onboardingScene2,
  onboardingScene3,
  onboardingScene4,
  onboardingScene5,
] as const;
