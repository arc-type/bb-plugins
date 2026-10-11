Find earlier threads and tasks by meaning, not only by exact words.

## What you get

- **Recall: search everything** in the command palette (Mod+S). It opens
  a search window styled like the palette, with Fast (keywords) and Smart
  (meaning, reranked) modes, filters for threads and tasks, and keyboard
  navigation. Enter opens a thread. Mod+Enter continues the search in the
  side panel.
- A **Recall** tab in a thread's right panel with results and a preview of the
  indexed text.
- `recall_search` and `recall_get` tools for agents, and a `bb recall` command
  (`search`, `status`, `reindex`).

## How it works

Every minute Recall writes each changed thread (user and assistant messages,
no tool output) and each BB task as a Markdown file into its own data folder.
It then has [qmd](https://github.com/tobi/qmd) index those files. A search
combines BB's built-in keyword search with qmd's results through reciprocal
rank fusion, so a hit found by both rises to the top. Recall keeps its own qmd
index and never touches your default qmd index or its collections.
Everything runs locally.

## Requirements

`qmd` on the server's PATH (`npm i -g @tobilu/qmd`). Without it, Recall falls
back to BB's keyword search and says so in the results.
