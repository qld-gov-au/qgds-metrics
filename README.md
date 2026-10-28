# QGDS metrics

This project measures how the Queensland Government Design System (QGDS) is used. It does 2 things:

- It visits Queensland Government websites and checks whether each one uses QGDS.
- It collects usage figures from the QGDS library in Figma.

The results go into a dashboard that you can open in a web browser.

The code in this repository is public. The results are private. They are kept in a private database and are never saved here.

## What you can do

- [Look at the dashboard](#look-at-the-dashboard)
- [Run the monthly website check](#run-the-monthly-website-check)
- [Find websites missing from the list](#find-websites-missing-from-the-list)
- [Add new websites to the list](#add-new-websites-to-the-list)

You need to [set up your computer](#set-up-your-computer) once before you do any of these.

## Before you start

Ask the QGDS team for:

- access to this repository on GitHub
- the values that go in your `.env` file (you will set this up below)

To check websites, you also need to be on a Queensland Government work network. Many government websites block other networks, such as cloud servers.

## Set up your computer

You only need to do this once. It takes about 20 minutes.

1. Install these programs:
   - **Node.js**, version 24 or later, from [nodejs.org](https://nodejs.org)
   - **Git**, from [git-scm.com](https://git-scm.com)
   - **GitHub CLI**, from [cli.github.com](https://cli.github.com)
2. Open a terminal. On a Mac, open the Terminal app. On Windows, open PowerShell.
3. Sign in to GitHub:

   ```
   gh auth login
   ```

4. Download this project and go into its folder:

   ```
   gh repo clone qld-gov-au/qgds-metrics
   cd qgds-metrics
   ```

5. Install what the project needs, including the browser it uses to check websites:

   ```
   npm ci
   npx playwright install chromium
   ```

6. Make a copy of `.env.example` and name it `.env`. Open `.env` in a text editor and fill in the values from the QGDS team. Keep this file private.
7. Download the private files, including the list of websites:

   ```
   npm run data:pull
   ```

Run every command from the `qgds-metrics` folder.

## Look at the dashboard

There are 2 ways to see the dashboard.

### Download the latest version

You need access to the Supabase project for this, but you do not need to set up your computer.

1. Open the Supabase project in your browser and go to **Storage**.
2. Open the `metrics-data` bucket, then the `builds` folder.
3. Open the newest folder. The folder names are dates.
4. Download `qgds-metrics-dashboard.zip`.
5. Unzip it and open `index.html` in your browser.

### Run it on your computer

Use this to see the newest data, or to try changes to the dashboard.

1. Get the newest data:

   ```
   npm run export
   ```

2. Start the dashboard:

   ```
   npm run dashboard:dev
   ```

3. Open [http://localhost:4173](http://localhost:4173) in your browser.

Leave the terminal open while you look. If you change a file in `dashboard/src`, the page updates by itself. To stop, press **Ctrl** and **C** together in the terminal.

## Run the monthly website check

Do this once a month, from a work network:

```
npm run monthly
```

This does 2 things:

1. It visits every website on the list, one at a time, and records what it finds. This takes about 12 seconds for each site, so 450 sites take about an hour and a half. It shows its progress every 25 sites.
2. When the check is finished, it builds a new dashboard and saves it in Supabase Storage.

Keep your computer on, plugged in and awake until it finishes. If you close the lid, the check stops.

### If the check stops part way

Nothing is lost. Every site checked so far is saved. To finish the check and build the dashboard, run:

```
npm run monthly -- --resume
```

### To see how far it has got

Open a second terminal in the `qgds-metrics` folder and run:

```
npm run crawl:status
```

It tells you how many sites are done, how long is left, and whether the check seems stuck.

### What happens automatically

You do not need to do anything for these:

- Figma usage figures are collected every time the dashboard is built.
- The dashboard is rebuilt on its own at 3 am on the 2nd of each month, Brisbane time, using the newest results.
- If the newest website check is more than 35 days old, the dashboard shows a warning.

## Find websites missing from the list

This finds Queensland Government websites that are not on the list yet. Run it every month or two, from a work network, but not while the monthly website check is running.

### 1. Find candidates

```
npm run data:pull
npm run discover
```

This:

1. Gets every `qld.gov.au` website address from public records of website security certificates.
2. Leaves out addresses already on the list, addresses you rejected before, councils, and addresses that are clearly test or technical systems.
3. Visits the rest, one at a time per website, to see which are real public websites or apps.
4. Writes the results to `fixtures/discovery/candidates.csv`.

The first run takes about half an hour. Later runs only visit new addresses, so they are much quicker.

If it says the certificate records could not be reached, your network is blocking them. It then uses the last saved copy, which is fine. Every month or two, run `npm run discover` from home internet or a phone hotspot to refresh that copy.

### 2. Review the candidates

Open `fixtures/discovery/candidates.csv` in Excel or Numbers. Each row is a website or app that is not on the list. The organisation, department and brand tier are filled in from the closest site already on the list, so check them.

In the `decision` column, type:

- `add` to add it to the list
- `skip` if it does not belong, so it is never suggested again
- nothing, to decide later

Use the rules in [Decide whether a site belongs on the list](#3-decide-whether-a-site-belongs-on-the-list).

### 3. Apply your decisions

Save the file as CSV. Then run:

```
npm run discover:apply
npm run sites:import -- fixtures/sites.csv
npm run data:push
```

The new websites are checked the next time you run `npm run monthly`.

## Add new websites to the list

The list of websites is in `fixtures/sites.csv`. It is a spreadsheet, so you can open it in Excel or Numbers.

### 1. Get the newest list

```
npm run data:pull
```

### 2. Add a row for each website

Each row has these columns:

| Column | What to put in it | Example |
| --- | --- | --- |
| `url` | The website address | `https://site-a.example/` |
| `organisation` | The agency that runs the site | `example-agency` |
| `department` | The department it belongs to, as named on the [ministers and departments page](https://www.qld.gov.au/government/premier-ministers-departments/ministers-departments) | `Example department` |
| `brand_tier` | Where it sits in the [QGDS brand architecture](https://www.designsystem.qld.gov.au/brand-foundations/brand-architecture): `master_brand`, `sub_brand`, `co_brand`, `endorsed` or `stand_alone` | `sub_brand` |
| `kind` | `website`, or `app` if it is a tool or service people sign in to | `website` |
| `needs_review` | `yes` if you are not sure about the details, otherwise `no` | `no` |
| `active` | `yes` to check the site each month, `no` to stop checking it but keep its history | `yes` |

Tip: if the department is not obvious, look at the bottom of the website. Most government sites name their department there.

### 3. Decide whether a site belongs on the list

Include:

- department and agency websites
- statutory bodies
- campaign websites, even old ones that are still online
- apps and services people sign in to (set `kind` to `app`)

Do not include:

- council websites, because councils are a different level of government
- websites that are only for staff, such as intranets
- organisations that work with government but are not part of it
- pages that are just part of a website already on the list
- addresses that only redirect to a website already on the list

If a website stops loading, set `active` to `no` instead of deleting the row.

### 4. Save the list and load it

Save the file as CSV. Then run:

```
npm run sites:import -- fixtures/sites.csv
npm run data:push
```

The first command checks every row and loads the list. If it finds a problem, it tells you the line number and changes nothing. The second command saves your copy of the list in private storage.

The new websites are checked the next time you run `npm run monthly`.

## Keep the results private

This repository is public, so anyone can read what is saved here. To keep the results private:

- Never put real website addresses, agency names, team names or results in code, commit messages or pull requests. Use made-up examples such as `https://site-a.example` and `example-agency`.
- Never share your `.env` file or any of its values.
- Keep data files in the `fixtures` folder. That folder is never saved to the repository. Use `npm run data:push` and `npm run data:pull` to share them through private storage.

A check runs on every change to stop data files being saved here by mistake.

## If something goes wrong

| What you see | What to do |
| --- | --- |
| `Missing environment variable` | A value is missing from your `.env` file. Compare it with `.env.example`. |
| The website check says many sites failed to load | You are probably not on a work network. Connect to one and run `npm run monthly -- --resume`. |
| `The GitHub CLI is not installed or not signed in` | Run `gh auth login`. |
| The import says there is a problem with a line | Open `fixtures/sites.csv`, fix that line, save, and import again. |
| `No snapshot at dashboard/data/snapshot.json` | Run `npm run export` first, then `npm run dashboard:dev`. |
| The dashboard says `Data could not be loaded` | The download is incomplete. Download the zip again, or run `npm run export` and `npm run dashboard:dev`. |

## For developers

`CLAUDE.md` explains how the project is built and the rules it follows. The `contract` folder defines the data that flows between each part.

Before you commit, run all the checks:

```
npm run check
```
