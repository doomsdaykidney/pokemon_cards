# Pokédex 4×4 Card Binder

A static web application that displays all 1,025 National Pokédex entries in a 4×4 (16-pocket) binder layout with Pokémon card-proportioned (`5:7`) template cards and sprites.

## How to Host for Free on GitHub Pages

1. **Create a GitHub Repository** (e.g., `pokemon_cards`) and push these files (`index.html`, `style.css`, `app.js`, `collection.json`, `README.md`) to the `main` branch.
2. In your GitHub repository, go to **Settings → Pages**.
3. Under **Build and deployment**, select **Deploy from a branch**, choose `main` and `/ (root)`, and click **Save**.
4. Your site will be live at `https://<your-username>.github.io/pokemon_cards/`.

## Setting Up Shared Editing for 2+ People Across Devices

1. In your GitHub account, go to **Settings → Developer settings → Personal access tokens → Fine-grained tokens** and click **Generate new token**.
2. Set **Repository access** to **Only select repositories** and pick your `pokemon_cards` repository.
3. Under **Permissions → Repository permissions**, set **Contents** to **Read and write**.
4. Generate the token and copy it.
5. Open your GitHub Pages URL on each person's phone or computer, click **Sync Setup** in the top right, enter your GitHub username, repo name (`pokemon_cards`), and paste the shared token.
6. Any card clicked by either person automatically merges with the latest `collection.json` in your repository so edits never overwrite each other.

