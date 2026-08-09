# Chrome Web Store Submission

This document contains the current listing copy, permission explanations, privacy disclosures, and release checklist for BoldVoice Vowel Progress Coach.

## Manifest Summary

- Name: `BoldVoice Vowel Progress Coach`
- Version: `1.11.5`
- Category: `Education`
- Language: `English`
- Visibility recommendation: `Unlisted` for the first external test, then `Public`
- Current summary: `Unofficial guided vowel training and progress tools for the BoldVoice vowel map.`

The name uses BoldVoice to describe compatibility. The listing must clearly say that this is unofficial and is not affiliated with, endorsed by, or produced by BoldVoice unless the publisher has written authorization.

## Store Listing Copy

### Detailed Description

BoldVoice Vowel Progress Coach is an unofficial companion for the BoldVoice Vowel Map. It turns the map's live vowel focus into guided pronunciation practice and keeps your training progress on your device.

Features:

- Live vowel focus feedback while you practice.
- Guided practice for pure sounds, onset transitions, coda transitions, word families, and mastery phrases.
- Ten-correct repetition goals with attempts, accuracy, coverage, skips, and progress history.
- Targeted training from the progress view for a specific sound or pattern.
- Free Play pronunciation games for additional practice.
- Pause and ready states so outside sounds are not counted accidentally.
- Local progress storage so you can continue from your previous position.

The extension reads the focused vowel state shown by the BoldVoice Vowel Map. It does not record microphone audio, access a camera, require an account, or send training progress to the publisher. It is not affiliated with or endorsed by BoldVoice.

### Privacy and Limited Use Disclosure

This extension reads the vowel-map focus and related page data only to provide live pronunciation feedback and training features. Training progress is stored locally in Chrome extension storage. The extension does not sell, share, advertise against, or transmit this data to the publisher or third parties. The use of data received from the BoldVoice Vowel Map and Chrome storage is limited to providing and improving the extension's single purpose.

## Privacy Dashboard Values

### Single Purpose

Enhance pronunciation practice on the BoldVoice Vowel Map with live vowel feedback, guided sound and word drills, and local progress tracking.

### Permission Justifications

`storage`:

> Stores the user's selected sound, current curriculum position, attempts, accuracy, skips, daily summaries, recent training history, and settings locally so training can resume and progress can be displayed. The extension does not sync or upload this data.

Site access from `content_scripts.matches`:

> Runs only on `https://boldvoice.com/games/vowel-map*` to read the vowel-map focus state and render the training interface. It does not run on unrelated sites.

### Remote Code

Select: `No, I am not using remote code.`

All executable JavaScript and CSS are packaged in the extension. `src/page-detector.js` requests anchor JSON data from the current BoldVoice page; it does not download or execute JavaScript code.

### Data Use

Disclose the following data handling in the dashboard:

- Website content/resources: the vowel-map focus and anchor data needed for the visible training feedback.
- Training progress: current item, selected sound, attempts, correctness, accuracy, skips, timestamps, and settings stored locally.
- No microphone audio, camera data, credentials, cookies, browsing history, personal communications, payment information, or personally identifiable information.
- No analytics, advertising, sale, or third-party sharing.

The extension does not collect or retain general browsing activity. It uses the current Vowel Map URL only to limit where the feature runs.

## Privacy Disclosure Note

The current extension uses local-only progress storage and reads BoldVoice page information only as needed to provide its visible training features. The Store listing and privacy policy should describe this clearly:

> Training progress and settings are stored locally in Chrome. The extension reads information from BoldVoice pages only as necessary to provide its training functionality. It does not record or upload audio, and it does not send training data to the publisher or share it with third parties.

No blocking first-run `Continue` or `Not now` confirmation is currently required for this local-only behavior. An unobtrusive privacy note in a future Settings or Help view would be sufficient product guidance. Revisit this decision if the extension later records microphone audio, sends data to a server, adds analytics, or handles data unrelated to pronunciation training.

## Listing Assets

Prepare these in the Developer Dashboard:

- Store icon: the packaged `assets/icon128.png`.
- Screenshots: at least one, preferably three to five, at `1280x800` or `640x400`.
- Small promotional tile: PNG or JPEG, `440x280`.
- Promotional video: a short YouTube demonstration of the real extension.
- Marquee image: PNG or JPEG, `1400x560`; optional for the initial listing.

Recommended screenshots:

1. Guided Training with the mini vowel map, target prompt, ready state, and repetition progress.
2. Progress History showing score movement, attempts, accuracy, and coverage.
3. Word Families with the family selector and drill progress.
4. Mastery phrases showing an up or down result after an attempt.
5. Free Play mode with the pronunciation game.

Screenshots should show the actual current product, use full bleed square corners, and avoid large marketing text or claims of affiliation.

## URLs And Support

The dashboard should contain:

- Homepage URL: a page controlled by the publisher that explains the extension.
- Support URL: a page or issue form where users can report problems.
- Privacy policy URL: a public HTTPS URL hosting `PRIVACY_POLICY.md`.

Do not use a BoldVoice-owned URL as the extension homepage or support page unless the publisher has permission to do so.

## Reviewer Instructions

Use the following test instructions if the Vowel Map is available without a restricted account:

1. Install the extension.
2. Open `https://boldvoice.com/games/vowel-map`.
3. If Chrome asks for site access, choose access on `boldvoice.com` and refresh the page.
4. Open the Guided view and choose a target vowel.
5. Click once on the page to enable optional success sounds.
6. Speak the target sound while the live vowel focus appears on the map.
7. Verify the prompt, mini map, ready/reload state, repetitions, accuracy, and Progress modal.
8. Open Free Play to verify the optional game mode.

If the page requires a login or paid subscription, provide a dedicated reviewer account in the dashboard. Never publish personal credentials in this repository or listing description.

## Packaging Checklist

The upload ZIP must contain `manifest.json` at its root. Include the files referenced by the manifest:

- `manifest.json`
- `assets/icon16.png`
- `assets/icon32.png`
- `assets/icon48.png`
- `assets/icon128.png`
- The JavaScript and CSS files under `src/` referenced by the manifest

Exclude tests, screenshots, source artwork, `.git`, and development-only files from the upload ZIP. Validate the ZIP before uploading, then submit it through the Chrome Developer Dashboard.

## Final Policy Decisions

- Keep the `Unofficial` wording unless there is written BoldVoice authorization.
- Do not add microphone, camera, tabs, history, cookies, webRequest, scripting, or broad host permissions.
- If a future feature needs new data or permissions, update the listing, privacy policy, in-product disclosure, and manifest together.
