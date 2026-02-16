require('dotenv').config();
const express = require('express');
const { Storage } = require('megajs');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.port || 3000;

// auth stuff for vercel
const user_auth = process.env.admin_user || 'aditya'; 
const pass_auth = process.env.admin_pass || 'musicopass'; 
let mega_storage;

app.use(express.static('public'));

// connect to mega
async function start_mega() {
    try {
        mega_storage = await new Storage({
            email: process.env.mega_email,
            password: process.env.mega_password,
            autologin: true
        }).ready;
        console.log('connected to mega as ' + mega_storage.name);
    } catch (e) {
        console.log('login failed');
    }
}
start_mega();

// read the complete_filenames.txt file
app.get('/api/playlist', (req, res) => {
    const { user, pass } = req.query;
    if (user !== user_auth || pass !== pass_auth) return res.status(401).send('no');

    try {
        const file_path = path.join(__dirname, 'Complete_filenames.txt');
        const data = fs.readFileSync(file_path, 'utf8');
        // split by lines and clean up empty ones
        const songs = data.split('\n').map(s => s.trim()).filter(s => s !== '');
        res.json(songs);
    } catch (err) {
        res.status(500).send('cant find the txt file');
    }
});

// stream logic
app.get('/stream', async (req, res) => {
    const { filename, user, pass } = req.query;
    
    if (user !== user_auth || pass !== pass_auth) return res.status(401).send('no');

    try {
        const main_folder = mega_storage.root.children.find(f => f.name === 'main' && f.directory);
        if (!main_folder) return res.status(404).send('main folder missing');

        // we look for the filename. if your mega files dont have .mp3 in the txt, we add it here
        const clean_name = decodeURIComponent(filename);
        const song_file = main_folder.children.find(f => f.name === clean_name || f.name === clean_name + '.mp3');
        
        if (!song_file) return res.status(404).send('song not in mega');

        res.setHeader('content-type', 'audio/mpeg');
        const download_stream = song_file.download();
        download_stream.pipe(res);
    } catch (error) {
        res.status(500).send('stream error');
    }
});

app.listen(port, () => console.log('server running on http://localhost:' + port));