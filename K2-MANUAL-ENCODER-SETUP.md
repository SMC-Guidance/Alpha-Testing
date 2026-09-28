# Kinder–Grade 2 Manual Paper Encoder

## Install

1. In Apps Script, replace `Code.gs` with `backend/Code.gs` and `EvalExport.gs` with `backend/EvalExport.gs`.
2. Replace `appsscript.json` with `backend/appsscript.json`.
3. Save, run `authorizeOnce`, and approve the requested Drive, Docs, Forms, Sheets, external-request, and email permissions.
4. Open **Deploy > Manage deployments**, edit the deployment already used by `js/config.js`, choose **New version**, and deploy.
5. Upload all website files to the configured GitHub Pages branch/folder.
6. Wait for GitHub Pages to publish, then clear the site's browser data once.

## One-row teacher/subject batch

1. Open **Teachers Evaluation > Kinder–Grade 2 Manual Evaluation**.
2. Enter the teacher as `SURNAME, FIRST NAME`, enter the subject, and enter a numbers-only school year. These values apply to the entire batch. Teacher names, student names, and subjects are automatically stored in ALL CAPS.
3. Class Number is optional. Enter the student name, grade level (Kinder, Grade 1, or Grade 2), all 13 answers, and comment for a paper.
4. Click **Add paper to batch**, then continue entering the remaining papers.
5. Click **Save entire batch**. All staged papers are saved together as one row in the private `K2 Manual Batches` sheet; they are not stored as separate database rows.
6. Once the batch is saved and has no unsaved changes:
   - **Preview compiled PDF** creates one PDF containing answered paper copies only, previews it inside the website, saves it in Drive, and enables browser download.
   - **Build result template** writes all papers to the existing Kinder–Grade 2 spreadsheet template. Its result tab is named `KINDER-G2 – [Subject]`.

## Save locations

- Compiled PDF: `Generated Evaluations / [Teacher surname] / K2 Answered Paper PDFs`
- Result workbook: `Generated Evaluations / [Teacher surname]`
- Browser download: the device's normal Downloads folder
- Raw batch record: private `K2 Manual Batches` sheet in the spreadsheet configured by `SHEET_ID`

Generated Drive files and browser downloads cannot automatically be attached to a chat message.

Teacher folders use the surname before the comma in the required `SURNAME, FIRST NAME` teacher format.

## Teachers Evaluation workspace

The Teachers Evaluation tab opens with two visual task cards. Choose **Online evaluation workbooks** or **Kinder–Grade 2 paper encoder**. Only the selected workspace appears, and the **Tools** button returns to the task chooser.
