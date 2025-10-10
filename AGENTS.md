# Repository Guidelines

## Project Structure & Module Organization
- Ambervision runs on Meteor + React; the client entry `client/main.jsx` mounts UI under `imports/ui`.
- Structured-product builders live in `imports/ui/components/structured-product`; hooks like `useStructuredProductBuilder` sit in `imports/hooks`.
- Domain logic, jobs, and blueprints reside in `imports/api/structured-products`; server methods/publications aggregate in `server/main.js`.
- Static assets stay in `public/`; tests land in `tests/`; root scripts (`create-test-clients.js`, `populate-local-db.js`) remain in the repo root.

## Build, Test, and Development Commands
- Run `meteor npm install` after cloning to keep the Meteor toolchain aligned.
- `npm start` boots Meteor with `settings.json` against Mongo on `127.0.0.1:3001`.
- `npm run test` executes the Mocha suite once via `meteortesting:mocha`.
- `npm run test-app` watches the full-app runner with a browser driver.
- `npm run visualize` compiles a production bundle and opens the performance visualizer.

## Coding Style & Naming Conventions
- Use two-space indentation, single quotes in JS/JSX, and PascalCase for components; hooks/utilities stay camelCase.
- Co-locate styles next to components (e.g., `DynamicProductBuilder.css`) and keep payoff types data-driven, not hardcoded.
- Guard `console.log` with dev checks; no automated formatter runs by default; match surrounding style.

## Testing Guidelines
- Write Mocha tests in `tests/` with the `.test.js` suffix; import Meteor globals through the test driver.
- Cover structured-product builders, schedule helpers, payoff execution, and job orchestration; prefer `npm run test-app` for React flows.

## Commit & Pull Request Guidelines
- Craft imperative, capitalized commit titles similar to "Add product report template"; bundle related changes together.
- Document data-migration effects when touching structured-product collections or root scripts.
- PRs should summarize the change, include screenshots for UI updates, link issues, and note required settings or API keys.

## Security & Configuration Tips
- Store secrets in `settings.local.json` under `settings.private`; override the bundled EOD token for production use.
- Use `start-meteor.bat` to export `MONGO_URL` and `MONGO_OPLOG_URL` when developing on Windows.
