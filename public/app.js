// Credentials are secure using cookies via backend now.
let current_playlist = [];

function enter_credentials() {
    const overlay = document.getElementById('login-modal-overlay');
    overlay.classList.remove('login-hidden');
    document.getElementById('login-error').innerText = '';
    document.getElementById('login-modal').classList.remove('login-shake');
    // Auto-focus the first input after the fade-in transition.
    setTimeout(() => document.getElementById('login-user').focus(), 350);
}

function close_login() {
    document.getElementById('login-modal-overlay').classList.add('login-hidden');
}

// Allow pressing Enter in either input to submit the form.
document.getElementById('login-user').addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('login-pass').focus(); });
document.getElementById('login-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit_login(); });

async function submit_login() {
    const user = document.getElementById('login-user').value;
    const pass = document.getElementById('login-pass').value;
    const errorText = document.getElementById('login-error');
    const submitBtn = document.getElementById('login-submit-btn');
    const modal = document.getElementById('login-modal');

    // Reset state.
    errorText.innerText = '';
    modal.classList.remove('login-shake');
    submitBtn.classList.add('login-loading');
    submitBtn.disabled = true;

    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user, pass })
        });
        if (res.ok) {
            submitBtn.classList.remove('login-loading');
            submitBtn.classList.add('login-success');
            submitBtn.querySelector('.login-btn-text').innerText = '✓ Connected';
            document.getElementById('auth-btn').innerText = "🔓 Ready to stream";
            document.getElementById('auth-btn').style.color = "#1db954";
            document.getElementById('auth-btn').style.borderColor = "#1db954";
            // Brief pause so the user sees the success state before the modal closes.
            setTimeout(() => {
                close_login();
                // Reset button for next time.
                submitBtn.classList.remove('login-success');
                submitBtn.querySelector('.login-btn-text').innerText = 'Connect';
                submitBtn.disabled = false;
                fetch_folders();
                load_tracks();
            }, 600);
        } else {
            submitBtn.classList.remove('login-loading');
            submitBtn.disabled = false;
            errorText.innerText = 'Invalid credentials';
            // Trigger the shake animation.
            void modal.offsetWidth; // force reflow
            modal.classList.add('login-shake');
        }
    } catch (e) {
        submitBtn.classList.remove('login-loading');
        submitBtn.disabled = false;
        errorText.innerText = 'Network error — check your connection';
        void modal.offsetWidth;
        modal.classList.add('login-shake');
    }
}

let current_track_index = -1;
let is_shuffle = false;
let current_folder = 'main';
let play_next_queue = [];   // tracks queued with the ⏭ "play next" button
let play_history = [];      // stack of previously played track indices for "previous" button
let dont_add_to_history = false; // flag to bypass adding to history when navigating back

// ghost_player silently preloads the upcoming track while the current one plays,
// so switching songs feels instant without any buffering gap.
const ghost_player = new Audio();
ghost_player.preload = 'auto'; 
let has_preloaded_next = false;

// ── SIDEBAR MOBILE TOGGLE ──────────────────────────────────────────

function toggle_sidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    sidebar.classList.toggle('open');
    overlay.classList.toggle('visible');
}

function close_sidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    sidebar.classList.remove('open');
    overlay.classList.remove('visible');
}

// ── FOLDERS ──────────────────────────────────────────────────────

async function fetch_folders() {
    const container   = document.getElementById('playlist-container');
    const mobile_tabs = document.getElementById('mobile-folder-tabs');
    if (container)   container.innerHTML = '<div class="sidebar-loading-text">Loading folders...</div>';
    if (mobile_tabs) mobile_tabs.innerHTML = '';

    try {
        const res = await fetch(`/api/folders`);
        if (res.status === 401) {
            if (container) container.innerHTML = '<div class="sidebar-error-text">Login to see your music.</div>';
            // Auto-open login if unauthorized
            enter_credentials();
            return;
        }
        if (!res.ok) throw new Error("Failed to fetch folders");
        const folders = await res.json();
        if (container) container.innerHTML = '';

        folders.forEach(folderName => {
            // ── Desktop sidebar item ──────────────────────────────
            if (container) {
                const div = document.createElement('div');
                div.className = 'folder-item';
                if (folderName === current_folder) div.classList.add('active');
                div.innerText = folderName;
                div.onclick = () => {
                    current_folder = folderName;
                    // Mark this folder active, clear others.
                    container.querySelectorAll('.folder-item').forEach(el => el.classList.remove('active'));
                    div.classList.add('active');
                    // Sync mobile tabs too.
                    if (mobile_tabs) {
                        mobile_tabs.querySelectorAll('.mobile-folder-tab').forEach(el => el.classList.remove('active'));
                        const match = [...mobile_tabs.querySelectorAll('.mobile-folder-tab')].find(el => el.dataset.folder === folderName);
                        if (match) match.classList.add('active');
                    }
                    // Clear and close search results on folder switch
                    const searchBox = document.getElementById('search-box');
                    if (searchBox) searchBox.value = '';
                    document.getElementById('search-results')?.classList.remove('open');
                    load_tracks();
                    close_sidebar();
                };
                container.appendChild(div);
            }

            // ── Mobile pill tab ───────────────────────────────────
            if (mobile_tabs) {
                const tab = document.createElement('div');
                tab.className = 'mobile-folder-tab';
                tab.dataset.folder = folderName;
                if (folderName === current_folder) tab.classList.add('active');
                tab.innerText = folderName;
                tab.onclick = () => {
                    current_folder = folderName;
                    mobile_tabs.querySelectorAll('.mobile-folder-tab').forEach(el => el.classList.remove('active'));
                    tab.classList.add('active');
                    // Sync desktop sidebar too.
                    if (container) {
                        container.querySelectorAll('.folder-item').forEach(el => el.classList.remove('active'));
                        const match = [...container.querySelectorAll('.folder-item')].find(el => el.innerText === folderName);
                        if (match) match.classList.add('active');
                    }
                    // Clear and close search results on folder switch (mobile)
                    const mobileSearch = document.getElementById('mobile-search-box');
                    if (mobileSearch) mobileSearch.value = '';
                    document.getElementById('mobile-search-results')?.classList.remove('open');
                    load_tracks();
                };
                mobile_tabs.appendChild(tab);
            }
        });
    } catch (error) {
        if (container) container.innerHTML = '<div class="sidebar-error-text">Failed to load folders.</div>';
        console.error("Folder Fetch Error:", error);
    }
}

// ── SHUFFLE / LOOP ────────────────────────────────────────────────

function toggle_shuffle() {
    is_shuffle = !is_shuffle;
    const btn = document.getElementById('shuffle-btn');
    // White fill = active, transparent = inactive — same visual pattern as loop.
    if (is_shuffle) {
        btn.classList.remove('glass-tint-muted');
        btn.style.backgroundColor = 'white';
        btn.style.color = 'black'; 
    } else {
        btn.style.backgroundColor = '';
        btn.style.color = '';
        btn.classList.add('glass-tint-muted');
    }
}

function toggle_loop() {
    const btn = document.getElementById('loop-btn');
    audio.loop = !audio.loop;
    if (audio.loop) {
        btn.classList.remove('glass-tint-muted');
        btn.style.backgroundColor = 'white';
        btn.style.color = 'black';
    } else {
        btn.style.backgroundColor = '';
        btn.style.color = '';
        btn.classList.add('glass-tint-muted');
    }
}

// ── TRACKS ────────────────────────────────────────────────────────

async function load_tracks() {
    document.getElementById('track-list').innerText = 'loading tracks...';
    document.getElementById('folder-title').innerText = current_folder;

    // Clear play history when playlist changes (folder switch)
    play_history = [];
    current_track_index = -1;

    try {
        const res = await fetch(`/api/playlist?folder=${encodeURIComponent(current_folder)}`);
        if (res.status === 401) {
            document.getElementById('track-list').innerText = 'Login to see your music.';
            return;
        }
        if (!res.ok) {
            const error_msg = await res.text();
            console.error("Server Error:", error_msg);
            document.getElementById('track-list').innerText = `Error ${res.status}: ${error_msg}`;
            return;
        }

        const list = await res.json();
        current_playlist = list;
        const container = document.getElementById('track-list');
        container.innerHTML = '';

        list.forEach((raw_item, idx) => {
            // Filenames are expected to follow "Artist - Title" convention.
            // If there's no dash, leave artist blank — the bullet separator
            // in CSS is :not(:empty) so it won't show for empty strings.
            let artist = "";
            let title = raw_item;
            if (raw_item.includes('-')) {
                const parts = raw_item.split('-');
                artist = parts[0].trim();
                title = parts.slice(1).join('-').trim();
            }

            const div = document.createElement('div');
            div.className = 'track-item';
            div.dataset.index = idx;
            
            const titleEl = document.createElement('div');
            titleEl.className = 'track-title';
            titleEl.textContent = title;
            
            const artistEl = document.createElement('div');
            artistEl.className = 'track-artist';
            artistEl.textContent = artist;
            
            div.appendChild(titleEl);
            div.appendChild(artistEl);
            
            div.onclick = () => play_song(raw_item, title, artist);

            // The queue button prepends to play_next_queue, so the chosen track
            // plays immediately after the current one, regardless of shuffle order.
            const queue_btn = document.createElement('button');
            queue_btn.className = 'queue-btn';
            queue_btn.innerText = '⏭';
            queue_btn.title = 'Play next';
            queue_btn.onclick = (e) => {
                e.stopPropagation();
                play_next_queue.unshift(raw_item);
                queue_btn.innerText = '✓';
                setTimeout(() => queue_btn.innerText = '⏭', 1000);
            };
            div.appendChild(queue_btn);
            container.appendChild(div);
        });
    } catch (error) {
        document.getElementById('track-list').innerText = 'Failed to load tracks. Check your connection.';
        console.error("Track Fetch Error:", error);
    }
}

// ── PLAYBACK ──────────────────────────────────────────────────────

function play_song(raw_name, title, artist) {
    has_preloaded_next = false;
    const new_index = current_playlist.indexOf(raw_name);

    // Track play history for "previous" button — push old index before updating
    if (current_track_index !== -1 && current_track_index !== new_index && !dont_add_to_history) {
        play_history.push(current_track_index);
        // Cap history to last 50 tracks to avoid memory growth
        if (play_history.length > 50) play_history.shift();
    }
    dont_add_to_history = false; // Reset flag
    current_track_index = new_index;

    // Auto-parse title and artist from filename if not provided
    if (!title) {
        const clean_name = raw_name.replace('.mp3', '').replace('.m4a', '').replace('.wav', '').replace('.flac', '');
        title = clean_name;
        artist = '';
        if (clean_name.includes('-')) {
            const parts = clean_name.split('-');
            artist = parts[0].trim();
            title = parts.slice(1).join('-').trim();
        }
    }

    // Highlight the active track in the list.
    document.querySelectorAll('.track-item').forEach(el => el.classList.remove('playing'));
    const active_el = document.querySelector(`.track-item[data-index="${current_track_index}"]`);
    if (active_el) active_el.classList.add('playing');

    document.getElementById('np-title').innerText = title;
    document.getElementById('np-artist').innerText = artist;

    const player = document.getElementById('audio-player');
    const progress_bar = document.getElementById('progress-bar');
    const play_btn = document.getElementById('play-btn');

    progress_bar.value = 0;

    const new_url = `/stream?filename=${encodeURIComponent(raw_name)}&folder=${encodeURIComponent(current_folder)}`;

    // If the ghost player already buffered this exact URL, hand off its src
    // so playback starts without a fresh network request.
    if (ghost_player.src === window.location.origin + new_url) {
        player.src = ghost_player.src;
    } else {
        player.src = new_url;
    }

    player.play().then(() => {
        play_btn.innerText = "⏸";
        update_media_session(title, artist);
    }).catch(e => console.error("Playback failed:", e));
}

// Starts buffering the next track 30 s before the current one ends,
// so there's no gap when the audio element fires 'ended'.
function preload_next_track() {
    if (current_playlist.length < 2) return;
    let next_index = current_track_index;
    if (is_shuffle) {
        while (next_index === current_track_index) {
            next_index = Math.floor(Math.random() * current_playlist.length);
        }
    } else {
        next_index = (current_track_index + 1) % current_playlist.length;
    }
    const raw_name = current_playlist[next_index];
    const next_url = `/stream?filename=${encodeURIComponent(raw_name)}&folder=${encodeURIComponent(current_folder)}`;
    ghost_player.src = next_url;
    ghost_player.load();
}

// ── GLOBAL SEARCH ─────────────────────────────────────────────────────
let global_search_debounce = null;
let global_search_abort = null;

async function global_search(query, is_mobile = false) {
    const results_box = is_mobile
        ? document.getElementById('mobile-search-results')
        : document.getElementById('search-results');
    const search_box = is_mobile
        ? document.getElementById('mobile-search-box')
        : document.getElementById('search-box');

    if (!results_box || !search_box) return;

    clearTimeout(global_search_debounce);
    if (global_search_abort) global_search_abort.abort();

    const q = query.trim();
    if (q.length < 2) {
        results_box.classList.remove('open');
        results_box.innerHTML = '';
        return;
    }

    global_search_debounce = setTimeout(async () => {
        try {
            global_search_abort = new AbortController();
            const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
                signal: global_search_abort.signal
            });
            if (!res.ok) throw new Error('Search failed');
            const results = await res.json();

            if (results.length === 0) {
                results_box.innerHTML = '<div class="search-empty">No matches found</div>';
                results_box.classList.add('open');
                return;
            }

            results_box.innerHTML = results.map(r => `
                <div class="search-result-item"
                     data-folder="${r.folder}"
                     data-filename="${r.filename}"
                     data-title="${r.title.replace(/"/g, '&quot;')}"
                     onclick="global_search_select(this)">
                    <span class="search-result-icon">🎵</span>
                    <div class="search-result-info">
                        <div class="search-result-title">${r.title}</div>
                        <div class="search-result-folder">${r.folder}</div>
                    </div>
                </div>
            `).join('');
            results_box.classList.add('open');
        } catch (e) {
            if (e.name !== 'AbortError') {
                console.error('Global search error:', e);
                results_box.innerHTML = '<div class="search-empty">Search failed</div>';
                results_box.classList.add('open');
            }
        }
    }, 180); // debounce
}

function global_search_select(el) {
    const folder = el.dataset.folder;
    const filename = el.dataset.filename;

    // Close search results
    document.getElementById('search-results')?.classList.remove('open');
    document.getElementById('mobile-search-results')?.classList.remove('open');
    const searchBox = document.getElementById('search-box');
    if (searchBox) searchBox.value = '';
    const mobileSearchBox = document.getElementById('mobile-search-box');
    if (mobileSearchBox) mobileSearchBox.value = '';

    // Switch to that folder if different
    if (folder !== current_folder) {
        current_folder = folder;
        // Update sidebar active state
        document.querySelectorAll('.folder-item').forEach(item => {
            item.classList.toggle('active', item.innerText === folder);
        });
        document.querySelectorAll('.mobile-folder-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.folder === folder);
        });
        load_tracks().then(() => {
            // After tracks load, play the selected song
            play_song(filename);
        });
    } else {
        // Same folder, just play
        play_song(filename);
    }
}

// Close search results when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrapper') && !e.target.closest('#mobile-top-row')) {
        document.getElementById('search-results')?.classList.remove('open');
        document.getElementById('mobile-search-results')?.classList.remove('open');
    }
});

// Also close on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.getElementById('search-results')?.classList.remove('open');
        document.getElementById('mobile-search-results')?.classList.remove('open');
        document.getElementById('search-box')?.blur();
        document.getElementById('mobile-search-box')?.blur();
    }
});

const audio = document.getElementById('audio-player');
const play_btn = document.getElementById('play-btn');
const progress = document.getElementById('progress-bar');
const current_time_text = document.getElementById('current-time');
const total_time_text = document.getElementById('total-time');

function play_next() {
    if (current_playlist.length === 0) return;
    let next_index = -1;
    // Manual "play next" queue takes priority over shuffle/sequential order.
    if (play_next_queue.length > 0) {
        const next_raw = play_next_queue.shift();
        const idx = current_playlist.indexOf(next_raw);
        if (idx !== -1) {
            load_track_from_index(idx);
            return;
        }
    }
    if (is_shuffle && current_playlist.length > 1) {
        let random_index = current_track_index;
        while (random_index === current_track_index) {
            random_index = Math.floor(Math.random() * current_playlist.length);
        }
        next_index = random_index;
    } else {
        next_index = (current_track_index + 1) % current_playlist.length;
    }
    load_track_from_index(next_index);
}

function play_prev() {
    if (current_playlist.length === 0) return;
    let prev_index = -1;
    dont_add_to_history = true; // Tell play_song to not push current track to play_history

    // Use play history regardless of shuffle mode — "previous" means "what played before"
    if (play_history.length > 0) {
        prev_index = play_history.pop();
    } else if (is_shuffle && current_playlist.length > 1) {
        // Fallback: if no history yet (first track), pick random
        let random_index = current_track_index;
        while (random_index === current_track_index) {
            random_index = Math.floor(Math.random() * current_playlist.length);
        }
        prev_index = random_index;
    } else {
        prev_index = current_track_index - 1;
        if (prev_index < 0) prev_index = current_playlist.length - 1;
    }
    load_track_from_index(prev_index);
}

// Re-parses the filename at a given index and calls play_song.
// Used by next/prev navigation so they don't duplicate the artist/title split logic.
function load_track_from_index(index) {
    const raw_name = current_playlist[index];
    let artist = "";
    let title = raw_name;
    if (raw_name.includes('-')) {
        const parts = raw_name.split('-');
        artist = parts[0].trim();
        title = parts.slice(1).join('-').trim();
    }
    play_song(raw_name, title, artist);
}

document.getElementById('next-btn').addEventListener('click', play_next);
document.getElementById('prev-btn').addEventListener('click', play_prev);
audio.addEventListener('ended', play_next);

function toggle_play() {
    if (audio.paused) audio.play();
    else audio.pause();
}

// Keep the play/pause icon in sync with the actual audio state.
audio.addEventListener('play',  () => play_btn.innerText = '⏸');
audio.addEventListener('pause', () => play_btn.innerText = '▶');

// If the MEGA stream drops mid-track, skip to the next song after a short delay
// rather than leaving the player frozen on an error state.
audio.addEventListener('error', () => {
    console.error("Playback error: File corrupted or MEGA stream failed.");
    document.getElementById('np-title').innerText = "⚠️ Stream error / Corrupted file. Skipping...";
    play_btn.innerText = '▶';
    setTimeout(play_next, 900);
});

// While the browser is waiting on the network, swap the title to "Loading stream..."
// then restore it the moment audio actually starts playing.
let current_track_title = "";
audio.addEventListener('waiting', () => {
    current_track_title = document.getElementById('np-title').innerText;
    if (current_track_title !== "⚠️ Stream error / Corrupted file. Skipping...") {
        document.getElementById('np-title').innerText = "Loading stream...";
    }
});
audio.addEventListener('playing', () => {
    if (current_track_title && document.getElementById('np-title').innerText === "Loading stream...") {
        document.getElementById('np-title').innerText = current_track_title;
    }
});

audio.addEventListener('timeupdate', () => {
    if (audio.duration) {
        progress.value = (audio.currentTime / audio.duration) * 100;
        current_time_text.innerText = format_time(audio.currentTime);
        total_time_text.innerText = format_time(audio.duration);
    }
    // Kick off preload when 30 s remain. The flag prevents duplicate calls.
    const time_remaining = audio.duration - audio.currentTime;
    if (time_remaining <= 30 && !has_preloaded_next) {
        has_preloaded_next = true;
        preload_next_track();
    }
    
    // Sync with Media Session API (lock-screen scrubber)
    if ('mediaSession' in navigator && audio.duration) {
        try {
            navigator.mediaSession.setPositionState({
                duration:     audio.duration,
                playbackRate: audio.playbackRate,
                position:     audio.currentTime
            });
        } catch(e) {}
    }
});

// Draw a background bar showing how much of the file is buffered.
// Walks buffered ranges from the end to find the last contiguous chunk.
const buffer_bar = document.getElementById('buffer-bar');
audio.addEventListener('progress', () => {
    if (audio.duration > 0) {
        for (let i = 0; i < audio.buffered.length; i++) {
            if (audio.buffered.start(audio.buffered.length - 1 - i) < audio.currentTime) {
                const buffered_end = audio.buffered.end(audio.buffered.length - 1 - i);
                buffer_bar.style.width = (buffered_end / audio.duration) * 100 + "%";
                break;
            }
        }
    }
});

progress.addEventListener('input', () => {
    audio.currentTime = (progress.value / 100) * audio.duration;
});

function format_time(seconds) {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}:${sec < 10 ? '0' : ''}${sec}`;
}

// ── MEDIA SESSION API (iPhone lock screen / Control Centre) ───────
// Populates the system media notification with title, artist, artwork,
// and wires up hardware media keys / lock-screen controls.
function update_media_session(title, artist) {
    if (!('mediaSession' in navigator)) return;

    navigator.mediaSession.metadata = new MediaMetadata({
        title:  title  || 'Unknown Title',
        artist: artist || 'Unknown Artist',
        album:  current_folder || 'MusiCo'
    });

    navigator.mediaSession.setActionHandler('play',         () => { audio.play();  play_btn.innerText = '⏸'; });
    navigator.mediaSession.setActionHandler('pause',        () => { audio.pause(); play_btn.innerText = '▶'; });
    navigator.mediaSession.setActionHandler('nexttrack',    play_next);
    navigator.mediaSession.setActionHandler('previoustrack',play_prev);
    navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime !== undefined) audio.currentTime = details.seekTime;
    });
}

// Keeps the lock-screen scrubber bar in sync with actual playback position.
// Handled in the main timeupdate listener above.

window.addEventListener('DOMContentLoaded', () => {
    // Boot sequence: load folder list and default playlist on page load.
    fetch_folders();
    load_tracks();

    if (typeof particlesJS !== 'undefined') {
        particlesJS("particles-js", {
            "particles": {
                "number": { "value": 60 },
                "color": { "value": "#ffffff" },
                "shape": { "type": "circle" },
                "opacity": { "value": 0.4 },
                "size": { "value": 2.5 },
                "line_linked": { "enable": true, "distance": 130, "color": "#ffffff", "opacity": 0.25, "width": 1 },
                "move": { "enable": true, "speed": 1.2 }
            },
            "interactivity": {
                "detect_on": "canvas",
                "events": { "onhover": { "enable": true, "mode": "grab" } }
            }
        });
    }

    if (typeof gsap !== 'undefined' && typeof Draggable !== 'undefined') {
        gsap.registerPlugin(Draggable);

        // Draggable is only enabled on desktop. On touch devices the elastic snap
        // would fight with native scroll, so we skip registering it entirely.
        if (!('ontouchstart' in window)) {
            Draggable.create(".custom-controls", {
                type: "x, y",
                dragClickables: false,
                minimumMovement: 10,
                onRelease: function () {
                    gsap.to(this.target, { x: 0, y: 0, duration: 1.5, ease: "elastic.out(1,0.3)" });
                }
            });
            Draggable.create("#playlist-wrapper", {
                type: "x, y",
                dragClickables: false,
                minimumMovement: 10,
                onRelease: function () {
                    gsap.to(this.target, { x: 0, y: 0, duration: 0.9, ease: "elastic.out(1,0.3)" });
                }
            });
        }
    }
    
    // App launches in shuffle mode by default
    toggle_shuffle();
});
