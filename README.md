# Northstar Talent

A simple responsive hiring-agency website that is ready to publish with GitHub Pages and connected to Supabase.

## Included

- Single public page with Home, Jobs, About, and Contact sections
- Searchable job list backed by a live Supabase database
- Candidate accounts, secure application submission, and private résumé uploads
- Protected admin page to add or close jobs, view applications, update statuses, and open short-lived résumé links

## Publish it on GitHub Pages

1. Create a GitHub repository and upload these files.
2. In **Settings → Pages**, deploy the `main` branch from the root folder.
3. GitHub will provide the public website address.

## Finish the live setup

The database, authentication integration, and private résumé bucket are already connected. Before using the site publicly:

1. Follow [SETUP.md](SETUP.md) to grant yourself the first administrator account.
2. Add the deployed GitHub Pages address to Supabase Auth's Site URL and Redirect URLs.
3. Configure a custom SMTP provider in Supabase before relying on account-confirmation or password-reset email.

The browser files contain only a Supabase publishable key. Never add a Supabase `service_role` key or any other secret to this repository.
