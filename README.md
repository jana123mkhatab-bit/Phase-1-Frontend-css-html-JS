# Campus in Motion: Phase 1 front end (HTML, CSS, JavaScript only)

A plain HTML + CSS + JavaScript version of the Campus in Motion university-bus front end.
No framework, no build step, no design tools, no npm packages. The browser runs the files as they are.

## Run it

Option A, with Node (any version 14 or newer):

    npm start

Option B, with Python:

    python -m http.server 5600

Then open **http://localhost:5600**

The app uses port **5600** (change it with `PORT=5700 npm start`). The React project uses 5173, so the two never overlap.
Its data is kept in this origin's `localStorage` under its own key, so it never touches the other project's data.

> Open it through a web server (as above), not by double-clicking `index.html`: browsers block JavaScript modules on `file://`.

## Demo accounts

| Role    | Email                | Password       |
|---------|----------------------|----------------|
| Student | student@campus.test  | Student#12345  |
| Student | student2@campus.test | Student#12345  |
| Admin   | admin@campus.test    | Admin#12345    |

## What is inside

    index.html          page shell (loads css/styles.css and js/main.js)
    css/styles.css      all styling (light / dark themes, Arabic RTL and English)
    js/main.js          start-up
    js/app.js           route table (hash routes such as #/student/track)
    js/core/            tiny helpers: html templates, DOM patching, views, router, i18n, auth, API client
    js/components/      shared pieces: layouts, map, timeline, forms, chat assistant, landing animations
    js/pages/           landing, login, 11 student pages, 13 administrator pages
    js/mock/            in-browser "server": the same data, rules and bus simulation as the full project
    server.js           optional zero-dependency static server

## Notes

* There is no real back end in Phase 1. `js/mock/` plays the server's part inside the browser (simulated buses, ETAs,
  reservations, notifications, admin tools, errand planner). Reset the data by clearing this site's storage.
* Bus positions are simulated and labelled "DEMO DATA", exactly like the full project.
* The map is the project's own SVG map (no Google Maps key is needed).
* Fonts load from Google Fonts when online and fall back to system fonts offline.
