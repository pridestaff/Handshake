# Complete the Northstar Talent setup

## 1. Publish the site

Upload this folder to a GitHub repository. In the repository, choose **Settings → Pages** and deploy the `main` branch from the root folder.

## 2. Set the sign-in redirect address

In Supabase, open **Authentication → URL Configuration**.

- Set **Site URL** to your published GitHub Pages address, for example `https://your-name.github.io/northstar-talent/`.
- Add that same address under **Redirect URLs**.

This allows account-confirmation and password-reset links to return visitors to your site.

## 3. Create the first administrator

1. Open the published website and select **Sign in → New here? Create an account**.
2. Confirm the account from the email Supabase sends you.
3. In Supabase, open **Authentication → Users**, open your new user, and copy its user ID.
4. In the Supabase SQL Editor, run the following after replacing the placeholder with that ID:

```sql
insert into public.admin_users (user_id)
values ('YOUR_AUTH_USER_ID');
```

You can now sign in at `/admin.html`. To approve another team member later, repeat this process with their user ID.

## 4. Configure production email

Before opening the site to applicants, add your own SMTP provider in Supabase Authentication. The default email service is only for limited testing.

## Security model

- Public visitors can read open jobs only.
- Candidates must be signed in to apply, and can only upload/read their own résumé.
- Résumés are in a private bucket, are limited to 5 MB and PDF/DOC/DOCX formats, and are never publicly linked.
- Administrators are recorded in `public.admin_users`; only they can manage jobs, view applications, and create temporary résumé links.
