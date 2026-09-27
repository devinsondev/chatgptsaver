# ChatGPT Chat Saver

Small Firefox add-on for saving the currently open ChatGPT conversation from the page DOM.

It does not call private ChatGPT APIs and does not download all chats from the account. It only works on the active `chatgpt.com` or `chat.openai.com` tab after you press the button.

## Install as a temporary Firefox add-on

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click `Load Temporary Add-on`.
3. Select `manifest.json` from this folder.
4. Open the needed temporary chat on `chatgpt.com`.
5. Click the add-on icon, then `Собрать текущий чат`.
6. You can close the popup while a large chat is being scanned. Reopen it to see the current progress.
7. If the counter already looks complete, click `Завершить сейчас` to stop scanning and use the collected result.

## What it saves

- Your prompts are marked as `You`.
- ChatGPT answers are marked as `ChatGPT`.
- The preview page shows messages in order.
- Downloads are available as Markdown and HTML.

## Notes

The add-on reads messages from the DOM and deeply scrolls the open conversation to collect virtualized turns. The scan runs in the background page, so the popup can be closed without losing progress. If ChatGPT no longer restores old turns while scrolling, those already-unloaded messages cannot be recovered from the DOM. If ChatGPT changes its page markup, the selectors in `contentScript.js` may need an update.
