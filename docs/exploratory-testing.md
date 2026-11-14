# Exploratory testing guide

For the owner, acting as the exploratory tester. Exploratory testing means using the product like a curious, slightly mischievous person and writing down everything that surprises you. You do not need to follow a script, and you do not need to be technical. This guide gives you places to look and ideas to try.

**What you are looking for:** bugs (it does something wrong or confusing), feature requests (it works but you wish it did more), and "this feels off" notes (wording, colors, speed, anything). All three are useful.

---

## 1. How to report what you find

Tell Claude in the chat, as you go, in your own words. A short note is enough, and a screenshot helps. Claude logs each one as a GitHub issue and keeps the running list.

For a bug, the most useful note says four things:

1. **Where you were** (the page or screen, web or phone, and which phone).
2. **What you did** (the steps, in order).
3. **What you expected.**
4. **What happened instead** (and the exact message, if there was one).

**Severity, so Claude can order the fixes:**

| Level | Meaning | Example |
| --- | --- | --- |
| Blocker | Cannot continue, or data is lost or exposed | Signing in fails; someone else's data is visible |
| Major | A main feature does not work | Search returns nothing when it should |
| Minor | Works, but wrong or awkward | A button looks stale when tapped |
| Polish | Wording, spacing, colors | Phone colors differ from the web |

You do not have to pick a level. Claude will propose one.

---

## 2. Where to test

| Place | Use it for |
| --- | --- |
| Your PC's dev server (started by Claude on request) | Everything, with sample data once it exists |
| The phone app on your phone (connects to the same dev server) | The phone screens |
| The live site, once one exists | Sign-up, sign-in, empty states, public pages, how it looks and feels for a stranger |

**Never type a real person's private information into any test.** Use made-up names and the test email style `name+clerk_test@example.com`.

---

## 3. Test charters

A charter is a short mission: "explore this area looking for these kinds of problems." Spend 15 to 30 minutes on one, then write down what you found. Add a charter for each feature as it ships.

### 3.1 Signing up and signing in

- [ ] Sign up with a test email (`yourname+clerk_test@example.com`). Is each step clear?
- [ ] Sign out, then try to open a protected page directly by its address. Where does it send you?
- [ ] Sign in on a second browser or private window at the same time. Do both work?

### 3.2 Any form

- [ ] Leave each field empty, then try a very long value, then odd characters. Are the error messages specific?
- [ ] Paste very long text, emoji, `<b>bold</b>` and quote marks. Nothing should break the page or show up as formatting.
- [ ] Press the save button twice quickly. Does anything happen twice?
- [ ] After an error, is what you typed still there?

### 3.3 Any page

- [ ] Try the page on a narrow window or your phone's browser. Does anything overflow, overlap, or become unreachable?
- [ ] Try keyboard only (Tab, Enter, Space). Can you do the whole task without the mouse? Can you always see where the focus is?
- [ ] Use the browser's Back button. Is your place still there?
- [ ] Sign in as a normal user and try to open an admin address. Nothing should leak.

### 3.4 The phone app

- [ ] Open the app cold (swipe it away first). How long until you see something? Is there a loading message?
- [ ] Turn on airplane mode and try the main task. Is it clear what to do next?
- [ ] Rotate the phone. Does anything break?
- [ ] Use the app with a big text size set in the phone's accessibility settings.
- [ ] Note anything that feels slow, small to tap, or confusing, even if it "works."

### 3.5 Feel and first impressions (always worth doing)

- [ ] Pretend you have never seen the app. Could you tell in ten seconds what it is for?
- [ ] Does the wording sound the way you want? Note any word that feels wrong.
- [ ] What is the one thing you most wished it did while you were testing?

---

## 4. Known gaps (no need to report these again)

Nothing is built yet beyond the foundation. Claude adds known gaps here as features ship.

## 5. After a testing session

Send Claude your notes in any shape (a list, a paste, photos). Claude will log them as issues, sort them by severity, and propose an order. You choose what comes first. Each bug that gets fixed also gets a guard (`/docs/lessons.md`).
