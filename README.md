# Bayward — Ricky Sparks

An interactive portfolio set in a miniature San Francisco Bay Area. Explore professional experience, projects and education through a driving journey, an electric Caltrain ride, or a direct reading view.

**[Visit the portfolio](https://rickyjames1750.github.io/)** · **[Download the resume](https://rickyjames1750.github.io/Ricky_Sparks_Resume_2026.pdf)**

## Experience

- **Read:** open any resume section. A permanent scroll rail, reading progress and highlighted “More below” control keep longer sections easy to navigate. Use the section selector for direct reading. Next section turns the paper with a brief sound and follows the selected car or train to the next stop.
- **Drive:** use WASD, arrow keys, or the right-hand mouse/touch joystick. Space brakes, H sounds the horn, C follows the car, Shift boosts and R resets.
- **Travel:** choose any of the five destinations for a guided trip. The Golden Gate Bridge connects to the driving route, including automatic return to resume stops.
- **Caltrain:** follow the electrified Peninsula corridor. The Future Portal preview illustrates a proposed connection to the Salesforce Transit Center.
- **Guide:** an optional narrator introduces Ricky’s background, experience, projects and education in the third person, with concise captions and subtle navigation highlights. Voice and Skip guide controls remain available while reading. Spoken guidance uses bundled, consistently mastered recordings and lowers the soundtrack while speaking. Device-generated voice fallback is disabled.
- **Sound:** adjust volume, music, world ambience and vehicle effects independently in Audio mix. Preferences persist across visits.
- **Classic view:** read all portfolio content without driving.

The optional **Bay Circuit** is a three-lap scenic race with three computer-controlled rivals, automatic acceleration, touch steering, randomized lane-specific boost pads, manual boost, and a finish leaderboard. Phones use landscape for racing and pause safely when rotated upright. A run takes roughly 90 seconds, and the portfolio remains one click away.

## Development

Requires Node.js 22 or later.

```sh
npm ci
npm run dev
npm test
npm run build
npm run preview
```

The build produces the static `dist/` directory. The GitHub Actions workflow runs the tests and publishes the site to GitHub Pages when `main` changes.

## Implementation

Built with Three.js, Vite and Web Audio. Procedural geometry and instancing provide the scenery, buildings, vehicles and vegetation. The renderer includes outdoor reflections, surface detail, atmospheric lighting and adaptive contact shading. Interface panels support keyboard, mouse and touch input, with reduced-motion and lower-cost rendering options.

- `src/world.js` — scene, rendering, transit and driving integration.
- `src/geography.js` — regional coordinate anchors and route alignment.
- `src/bridge-*.js`, `src/corridors.js` — connected roads, clearance and route safety.
- `src/vehicle-*.js`, `src/joystick.js` — grounding, suspension and controls.
- `src/urban-nature.js`, `src/city-detail.js` — vegetation and architecture.
- `src/audio.js` — score, soundscape, volume groups and recording mix.
- `src/resume-reader.js`, `src/page-turn.js` — permanent reading controls, paper animation and section navigation.
- `src/voice-guide.js` — optional narration, captions and guided itinerary.
- `src/content.js` — professional background and project descriptions.
- `tests/` — automated checks for navigation, geometry, input, audio and UI lifecycle.

## Map and credits

The map uses real regional anchors with generalized distances, coastlines and building dimensions. It is a portfolio setting rather than a navigation map or service timetable. Resume stops are narrative destinations, not employer addresses. Landmark and brand references do not imply affiliation. Academic credentials are listed in the resume.

Dependency and asset licenses are retained in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
