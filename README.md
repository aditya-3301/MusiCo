# MusiCo

**MusiCo** is a serverless personal music streaming web application.  
Instead of stupid Spotify, where you **listen to ads** and **skip music**, MusiCo uses **MEGA.nz** as a completely free, massive backend storage solution.

- Node.js  
- Express  
- Frontend wrapper via **Vercel Serverless Functions**

## Features

* **MEGA.nz Integration:** Uses the `megajs` library to fetch, decrypt, and stream audio directly from your MEGA cloud storage.
* Basic authentication ensures only you (or your friends) can access your music library.
* **Serverless Streaming:** Utilizes Vercel's serverless architecture to proxy audio streams directly to the browser.  

**(Gemini mostly helped implement this because documentation on this is not that good)**
 

## Tech Stack

**Frontend:**
* HTML5 / CSS3 
* Vanilla JavaScript
* [GSAP](https://greensock.com/gsap/) (for smooth animations and draggable components)

**Backend:**
* Node.js
* Express.js
* [MEGA.js](https://mega.js.org/docs/1.0/tutorial/install) (unofficial MEGA API client)
* Vercel (Hosting & Serverless Functions)

---

## Environment Variables

To run this project, you will need to add the following environment variables to your `.env` file (for local development) and to your **Vercel Project Settings** (for production):

| Variable | Description |
| :--- | :--- |
| `MEGA_EMAIL` | The email address of your MEGA.nz account |
| `MEGA_PASSWORD` | The password for your MEGA.nz account |
| `admin_user` | The username required to log into the web UI |
| `admin_pass` | The password required to log into the web UI |


---

## Local Development Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/aditya-3301/MusiCo
   cd MusiCo
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up your environment variables:**
   
   Create a `.env` file inside the **api folder** and add your MEGA and admin credentials:

   ```env
   MEGA_EMAIL=your_mega_email@gmail.com
   MEGA_PASSWORD=your_mega_password
   admin_user=your_user
   admin_pass=any_password_which_you_choose
   ```

4. **Start the local server:**
   ```bash
   node index.js
   ```
   Open port 3000 to see the website

---

## Deployment (Vercel)

Deploying MusiCo to Vercel is easy.
```
(I have an alternate private version deployed to Netlify but deploying it there is a real pain but you get ~100GB bandwidth compared to the measly 10GB you get in vercel)
```

1. Push your code to a git repo.
2. Log in to Vercel and import your MusiCo GitHub repository.
3. Before clicking **Deploy**, open the **Environment Variables** tab in Vercel and add the following variables:
   - `MEGA_EMAIL`
   - `MEGA_PASSWORD`
   - `ADMIN_USER`
   - `ADMIN_PASS`
4. Click **Deploy**.

Vercel will automatically deploy.(hopefully :p)

---

## Folder Structure Setup (MEGA)

For MusiCo to read your files properly, structure your MEGA.nz drive like this:  
**HAVE ONLY mp3/m4a FILES**  
The app specifically filters for `.mp3` and `.m4a` file extensions. 

```plaintext
MEGA Drive/
 ├── Playlist 1/
 │    ├── song1.mp3
 │    ├── song2.m4a
 ├── Playlist 2/
 │    ├── track1.mp3
```


---

##
Created by Aditya Shankar  
Thank you so much megajs for creating an unofficial mega api.
---
