require('dotenv').config();
const express = require('express');
const { Storage } = require('megajs');

const app = express();
const port = process.env.port || 3000;

// auth stuff for vercel
const user_auth = process.env.admin_user.trim(); 
const pass_auth = process.env.admin_pass.trim();

app.use(express.static('..'));

let mega_storage = null;
let connection_promise = null; // Prevents multiple requests from logging in at the same time

// --- THE VERCEL FIX: Smart MEGA Connection Manager ---
async function get_mega_client() {
    // 1. If connected, return instantly
    if (mega_storage) return mega_storage;
    
    // 2. If currently logging in, wait for that to finish
    if (connection_promise) return connection_promise;

    // 3. Otherwise, log in to MEGA and save the session
    console.log("Waking up server: Connecting to MEGA...");
    connection_promise = new Promise(async (resolve, reject) => {
        try {   
            const storage = await new Storage({
                email: process.env.MEGA_EMAIL,       // Matches your .env uppercase
                password: process.env.MEGA_PASSWORD, // Matches your .env uppercase
                autologin: true
            }).ready;
            
            mega_storage = storage;
            console.log('Connected to MEGA as ' + mega_storage.name);
            resolve(mega_storage);
        } catch (e) {
            console.error('MEGA login failed because:', e.message || e);
            connection_promise = null; // Reset so we can try again
            reject(e);
        }
    });

    return connection_promise;
}

// read the complete_filenames.txt file
// read dynamically from MEGA main folder
app.get('/api/playlist', async (req, res) => {
    const { user, pass } = req.query;
    if (user !== user_auth || pass !== pass_auth) return res.status(401).send('no');

    try {
        // Automatically wake up/connect to MEGA if Vercel went to sleep
        const storage = await get_mega_client();
        const main_folder = storage.root.children.find(f => f.name === 'main' && f.directory);
        if (!main_folder) return res.status(404).send('main folder missing');

        // Map through the children of the main folder to get filenames 
        // and remove '.mp3' for a cleaner look in the frontend
        const songs = main_folder.children
            .filter(f => !f.directory) // Ensure we only get files
            .map(f => f.name.replace('.mp3', '')); 
            
        res.json(songs);
    } catch (err) {
        console.error(err);
        res.status(500).send('failed to fetch files from mega');
    }
});

// stream logic
app.get('/stream', async (req, res) => {
    const { filename, user, pass } = req.query;
    
    if (user !== user_auth || pass !== pass_auth) return res.status(401).send('no');

    // Prevent crashing if MEGA hasn't finished logging in yet
    if (!mega_storage || !mega_storage.root) {
        return res.status(503).send('MEGA is still connecting, try again in a few seconds');
    }

    try {
        // Automatically wake up/connect to MEGA if Vercel went to sleep
        const storage = await get_mega_client();
        const main_folder = storage.root.children.find(f => f.name === 'main' && f.directory);
        if (!main_folder) return res.status(404).send('main folder missing');

        const clean_name = decodeURIComponent(filename);
        // Look for exact match, .mp3, or .m4a
        const song_file = main_folder.children.find(f => 
            f.name === clean_name || 
            f.name === clean_name + '.mp3' ||
            f.name === clean_name + '.m4a'
        );
        
        if (!song_file) return res.status(404).send('song not in mega');

        // --- NEW: Handle Browser Range Requests for Buffering ---
        const size = song_file.size;
        const range = req.headers.range;

        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : size - 1;
            const chunksize = (end - start) + 1;

            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${size}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': 'audio/mpeg',
            });
            
            const download_stream = song_file.download({ start, end });
            download_stream.pipe(res);
        } else {
            res.writeHead(200, {
                'Content-Length': size,
                'Content-Type': 'audio/mpeg',
            });
            const download_stream = song_file.download();
            download_stream.pipe(res);
        }

    } catch (error) {
        console.error("Stream crash:", error);
        res.status(500).send('stream error');
    }
});

module.exports = app;