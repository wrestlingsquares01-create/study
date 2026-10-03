'use strict';

/* =========================
   SUPABASE CONFIGURATION
========================= */

const config = window.PRSN_CONFIG || {
  supabaseUrl: 'https://jhgqamhaxhfjsimslptx.supabase.co',
  supabasePublishableKey:
    'sb_publishable_6hquh6my3nuk5VHWMISyWQ_fz4z3cmr'
};

const configured = Boolean(
  config.supabaseUrl && config.supabasePublishableKey
);

let db = null;
let startupError = '';

if (configured) {
  try {
    if (!window.supabase) {
      throw Error(
        'Supabase could not load. Check your internet and refresh.'
      );
    }

    db = window.supabase.createClient(
      config.supabaseUrl,
      config.supabasePublishableKey
    );
  } catch (error) {
    startupError = error.message;
  }
}

const preview = !configured;

function requireBackend() {
  if (!db) {
    throw Error(
      startupError ||
      'Design preview only. Connect Supabase in script.js to share and chat.'
    );
  }
}

/* =========================
   HELPERS AND STATE
========================= */

const $ = id => document.getElementById(id);

const subjects = [
  'Mathematics',
  'Science',
  'English',
  'Hindi',
  'Social Science',
  'Sanskrit',
  'General'
];

const types = {
  prep: 'Test preparation',
  homework: 'Homework',
  resource: 'Resource'
};

const mime = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
};

let uid;
let userName;
let view = 'all';
let posts = [];
let limit = 30;
let request = 0;

let chatChannel;
let boardChannel;
let chatGeneration = 0;
let messages = new Map();
let loadingOlder = false;

let toastTimer;
let pollTimer;
let searchTimer;

function node(tag, text, cls) {
  const element = document.createElement(tag);

  if (text !== undefined) {
    element.textContent = text;
  }

  if (cls) {
    element.className = cls;
  }

  return element;
}

function fail(error) {
  return error?.message || 'Connection failed. Please try again.';
}

function toast(text) {
  $('toast').textContent = text;
  $('toast').hidden = false;

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    $('toast').hidden = true;
  }, 4500);
}

function checked(result) {
  if (result.error) {
    throw result.error;
  }

  return result.data;
}

async function busy(form, output, action) {
  const buttons = [...form.querySelectorAll('button')];

  buttons.forEach(button => {
    button.disabled = true;
  });

  output.textContent = '';

  try {
    await action();
  } catch (error) {
    output.textContent = fail(error);
  } finally {
    buttons.forEach(button => {
      button.disabled = false;
    });
  }
}

function dateText(date) {
  return new Date(date).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short'
  });
}

/* =========================
   INITIAL SETUP
========================= */

subjects.forEach(subject => {
  $('subject').add(new Option(subject, subject));
  $('filterSubject').add(new Option(subject, subject));
});

$('today').textContent = new Date().toLocaleDateString('en-IN', {
  weekday: 'short',
  day: 'numeric',
  month: 'long'
});

$('year').textContent = new Date().getFullYear();

try {
  $('name').value =
    localStorage.getItem('prsn-crimson-name') || '';
} catch {}

if (startupError) {
  $('loginError').textContent = startupError;
}

if (preview) {
  $('loginError').textContent =
    'Design preview — enter a name to explore.';
}

/* =========================
   NAME ENTRY
========================= */

$('loginForm').addEventListener('submit', event => {
  event.preventDefault();

  busy(event.currentTarget, $('loginError'), async () => {
    const name = $('name').value.trim();

    if (name.length < 2 || name.length > 20) {
      throw Error('Use a name between 2 and 20 characters.');
    }

    // Start during the submit gesture, before awaiting authentication.
    startMusic();

    if (!preview) {
      requireBackend();

      let session = checked(await db.auth.getSession()).session;

      if (!session) {
        session = checked(
          await db.auth.signInAnonymously()
        ).session;
      }

      if (!session?.user?.id) {
        throw Error(
          'Enable anonymous sign-ins in Supabase, then try again.'
        );
      }

      uid = session.user.id;
    }

    userName = name;

    try {
      localStorage.setItem('prsn-crimson-name', name);
    } catch {}

    $('userName').textContent = userName;
    $('avatar').textContent = userName[0].toUpperCase();

    $('login').hidden = true;
    $('app').hidden = false;
    $('previewNotice').hidden = !preview;

    await loadPosts();

    if (!preview) {
      startBoard();
      await loadUpcoming();

      clearInterval(pollTimer);

      pollTimer = setInterval(() => {
        if (document.hidden) return;

        loadPosts();
        loadUpcoming();

        if ($('chatDialog').open) {
          loadRecent(chatGeneration);
        }
      }, 20000);
    }
  });
});

$('exit').onclick = () => location.reload();

/* =========================
   BOARD FILTERS
========================= */

document.querySelectorAll('[data-view]').forEach(button => {
  button.onclick = () => {
    view = button.dataset.view;
    limit = 30;

    document.querySelectorAll('[data-view]').forEach(item => {
      item.classList.toggle('active', item === button);
    });

    $('heading').textContent =
      view === 'all' ? 'The shared desk.' : types[view];

    $('boardTitle').textContent =
      view === 'all' ? 'The shared board' : types[view];

    loadPosts();
  };
});

$('filterSubject').onchange = () => {
  limit = 30;
  loadPosts();
};

$('search').oninput = () => {
  clearTimeout(searchTimer);

  searchTimer = setTimeout(() => {
    limit = 30;
    loadPosts();
  }, 250);
};

$('refresh').onclick = () => {
  loadPosts();
  loadUpcoming();
};

$('morePosts').onclick = () => {
  limit += 30;
  loadPosts();
};

/* =========================
   LOAD SHARED POSTS
========================= */

async function loadPosts() {
  if (preview) {
    posts = [];
    renderPosts();

    $('boardStatus').textContent =
      'Preview only · No posts or personal data are loaded.';

    $('morePosts').hidden = true;
    return;
  }

  const ticket = ++request;

  $('boardStatus').textContent = 'Loading shared posts…';

  try {
    let query = db
      .from('prsn_study_posts')
      .select('*')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    if (view !== 'all') {
      query = query.eq('kind', view);
    }

    if ($('filterSubject').value) {
      query = query.eq('subject', $('filterSubject').value);
    }

    const term = $('search').value.trim();

    if (term) {
      query = query.ilike(
        'title',
        '%' + term.replace(/[\\%_]/g, '\\$&') + '%'
      );
    }

    const data = checked(await query);

    if (ticket !== request) return;

    posts = data.slice(0, limit);
    $('morePosts').hidden = data.length <= limit;

    renderPosts();
    $('boardStatus').textContent = '';

    const results = await Promise.all([
      db
        .from('prsn_study_posts')
        .select('id', { count: 'exact', head: true })
        .eq('kind', 'prep'),

      db
        .from('prsn_study_posts')
        .select('id', { count: 'exact', head: true })
        .eq('kind', 'homework'),

      db
        .from('prsn_study_posts')
        .select('id', { count: 'exact', head: true })
        .not('file_path', 'is', null)
    ]);

    if (ticket !== request) return;

    results.forEach((result, index) => {
      const target = ['prepCount', 'hwCount', 'fileCount'][index];

      $(target).textContent = result.error ? '—' : result.count;
    });
  } catch (error) {
    if (ticket === request) {
      $('boardStatus').textContent =
        'Could not load the board: ' + fail(error);
    }
  }
}

/* =========================
   FILE OPEN / DOWNLOAD
========================= */

function fileActions(row, bucket) {
  const wrap = node('div', undefined, 'file-actions');

  for (const download of [false, true]) {
    const button = node(
      'button',
      download
        ? '↓ Download'
        : '↗ ' + (row.file_name || 'Open file')
    );

    button.type = 'button';

    button.onclick = async () => {
      button.disabled = true;

      try {
        const data = checked(
          await db.storage.from(bucket).createSignedUrl(
            row.file_path,
            300,
            download
              ? { download: row.file_name || true }
              : {}
          )
        );

        const link = node('a');

        link.href = data.signedUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';

        document.body.append(link);
        link.click();
        link.remove();
      } catch (error) {
        toast(fail(error));
      } finally {
        button.disabled = false;
      }
    };

    wrap.append(button);
  }

  return wrap;
}

/* =========================
   RENDER POSTS
========================= */

function renderPosts() {
  $('posts').replaceChildren();

  if (!posts.length) {
    $('posts').append(
      node(
        'div',
        'Nothing here yet. Share the first note, homework or PDF.',
        'empty'
      )
    );

    return;
  }

  posts.forEach(post => {
    const card = node('article', undefined, 'post');
    const top = node('div', undefined, 'post-top');

    top.append(
      node('span', types[post.kind], 'tag'),
      node('span', post.subject, 'subject-tag')
    );

    card.append(top, node('h3', post.title));

    if (post.body) {
      card.append(node('p', post.body));
    }

    if (post.due_date) {
      card.append(
        node(
          'span',
          '📅 ' + dateText(post.due_date + 'T12:00:00'),
          'due'
        )
      );
    }

    if (post.file_path) {
      card.append(fileActions(post, 'prsn-study-files'));
    }

    const bottom = node('div', undefined, 'post-bottom');

    bottom.append(
      node(
        'span',
        post.author_name + ' · ' + dateText(post.created_at)
      )
    );

    if (post.author_id === uid) {
      const del = node('button', 'Delete', 'delete');

      del.onclick = () => deleteRow(
        post,
        'prsn_study_posts',
        'prsn-study-files',
        loadPosts
      );

      bottom.append(del);
    }

    card.append(bottom);
    $('posts').append(card);
  });
}

/* =========================
   DELETE OWN POST / MESSAGE
========================= */

async function deleteRow(row, table, bucket, after) {
  const item = table === 'prsn_chat_messages'
    ? 'message'
    : 'post';

  if (!confirm('Delete your ' + item + '?')) return;

  try {
    checked(
      await db.from(table).delete().eq('id', row.id)
    );

    if (row.file_path) {
      const cleanup = await db.storage
        .from(bucket)
        .remove([row.file_path]);

      if (cleanup.error) {
        toast('Post deleted; attached file cleanup failed.');
      }
    }

    await after();
  } catch (error) {
    toast(fail(error));
  }
}

/* =========================
   BOARD REALTIME
========================= */

function startBoard() {
  if (boardChannel) {
    db.removeChannel(boardChannel);
  }

  boardChannel = db
    .channel('prsn-study-board')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'prsn_study_posts'
      },
      () => {
        loadPosts();
        loadUpcoming();
      }
    )
    .subscribe();
}

/* =========================
   MODALS AND UPLOADS
========================= */

document.querySelectorAll('[data-close]').forEach(button => {
  button.onclick = () => $(button.dataset.close).close();
});

$('addTop').onclick = () => {
  $('postForm').reset();
  $('kind').value = view === 'all' ? 'prep' : view;
  $('postError').textContent = '';
  $('postDialog').showModal();
};

function validateFile(file) {
  if (!file) return;

  if (!mime[file.type]) {
    throw Error('Choose a PDF, JPG, PNG, WebP or GIF.');
  }

  if (file.size > 10 * 1024 * 1024) {
    throw Error('File must be 10 MB or smaller.');
  }
}

async function upload(file, bucket) {
  if (!file) return {};

  validateFile(file);

  const path =
    uid + '/' + crypto.randomUUID() + '.' + mime[file.type];

  checked(
    await db.storage.from(bucket).upload(path, file, {
      contentType: file.type,
      upsert: false
    })
  );

  return {
    file_path: path,
    file_name: file.name.slice(0, 180),
    file_type: file.type
  };
}

async function insertWithFile(table, bucket, payload, file) {
  requireBackend();

  const attachment = await upload(file, bucket);

  try {
    return checked(
      await db
        .from(table)
        .insert({ ...payload, ...attachment })
        .select()
        .single()
    );
  } catch (error) {
    if (attachment.file_path) {
      await db.storage
        .from(bucket)
        .remove([attachment.file_path]);
    }

    throw error;
  }
}

/* =========================
   SHARE A POST
========================= */

$('postForm').onsubmit = event => {
  event.preventDefault();

  busy(event.currentTarget, $('postError'), async () => {
    const title = $('title').value.trim();

    if (!title) {
      throw Error('Add a title first.');
    }

    await insertWithFile(
      'prsn_study_posts',
      'prsn-study-files',
      {
        author_id: uid,
        author_name: userName,
        kind: $('kind').value,
        subject: $('subject').value,
        title,
        body: $('body').value.trim(),
        due_date: $('due').value || null
      },
      $('attachment').files[0]
    );

    $('postDialog').close();

    toast('Shared with the squad!');

    await loadPosts();
    await loadUpcoming();
  });
};

/* =========================
   COMMUNITY CODEWORD
========================= */

$('chatBtn').onclick = () => {
  $('codeForm').reset();
  $('codeError').textContent = '';
  $('codeDialog').showModal();
};

$('codeForm').onsubmit = event => {
  event.preventDefault();

  busy(event.currentTarget, $('codeError'), async () => {
    requireBackend();

    const unlocked = checked(
      await db.rpc('prsn_unlock_chat', {
        codeword: $('code').value.trim()
      })
    );

    if (!unlocked) {
      throw Error('Wrong codeword. Try again.');
    }

    $('codeDialog').close();
    $('code').value = '';

    await openChat();
  });
};

/* =========================
   OPEN REALTIME CHAT
========================= */

async function openChat() {
  const generation = ++chatGeneration;

  messages.clear();
  $('messages').replaceChildren();

  $('chatError').textContent = '';
  $('older').hidden = false;

  $('chatDialog').showModal();
  $('connection').textContent = 'Connecting…';

  chatChannel = db
    .channel('prsn-community-' + generation)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'prsn_chat_messages'
      },
      payload => {
        if (generation !== chatGeneration) return;

        if (payload.eventType === 'DELETE') {
          messages.delete(payload.old.id);
        } else {
          messages.set(payload.new.id, payload.new);
        }

        renderMessages(false);
      }
    )
    .subscribe(status => {
      if (generation !== chatGeneration) return;

      $('connection').textContent =
        status === 'SUBSCRIBED'
          ? 'Live · connected'
          : 'Reconnecting · checking messages every 20s';

      if (status === 'SUBSCRIBED') {
        loadRecent(generation);
      }
    });

  await loadRecent(generation, true);
  $('message').focus();
}

/* =========================
   LOAD CHAT MESSAGES
========================= */

async function loadRecent(generation, initial = false) {
  try {
    const rows = checked(
      await db
        .from('prsn_chat_messages')
        .select('*')
        .order('id', { ascending: false })
        .limit(50)
    );

    if (
      generation !== chatGeneration ||
      !$('chatDialog').open
    ) {
      return;
    }

    const newestIds = new Set(rows.map(row => row.id));

    const min = rows.length
      ? Math.min(...rows.map(row => row.id))
      : Infinity;

    for (const id of messages.keys()) {
      if (id >= min && !newestIds.has(id)) {
        messages.delete(id);
      }
    }

    if (!rows.length) {
      messages.clear();
    }

    rows.forEach(row => messages.set(row.id, row));

    renderMessages(initial);
    $('chatError').textContent = '';

    if (initial) {
      $('older').hidden = rows.length < 50;
    }
  } catch (error) {
    if (generation === chatGeneration) {
      $('chatError').textContent =
        'Chat could not load: ' + fail(error);
    }
  }
}

/* =========================
   RENDER CHAT
========================= */

function renderMessages(forceBottom = false) {
  const box = $('messages');

  const nearBottom =
    box.scrollHeight - box.scrollTop - box.clientHeight < 100;

  const oldTop = box.scrollTop;

  box.replaceChildren();

  const sorted = [...messages.values()].sort(
    (a, b) => a.id - b.id
  );

  if (!sorted.length) {
    box.append(
      node(
        'div',
        'The chat is ready. Say hello to your squad.',
        'empty'
      )
    );
  }

  sorted.forEach(row => {
    const card = node(
      'article',
      undefined,
      'message' + (row.author_id === uid ? ' mine' : '')
    );

    card.append(node('b', row.author_name));

    if (row.body) {
      card.append(node('p', row.body));
    }

    if (row.file_path) {
      card.append(fileActions(row, 'prsn-chat-files'));
    }

    card.append(
      node(
        'small',
        dateText(row.created_at) +
        ' · ' +
        new Date(row.created_at).toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit'
        })
      )
    );

    if (row.author_id === uid) {
      const del = node('button', 'Delete', 'delete');

      del.onclick = () => deleteRow(
        row,
        'prsn_chat_messages',
        'prsn-chat-files',
        () => {
          messages.delete(row.id);
          renderMessages();
        }
      );

      card.append(del);
    }

    box.append(card);
  });

  box.scrollTop = forceBottom || nearBottom
    ? box.scrollHeight
    : oldTop;
}

/* =========================
   OLDER CHAT MESSAGES
========================= */

$('older').onclick = async () => {
  if (loadingOlder || !messages.size) return;

  loadingOlder = true;
  $('older').disabled = true;

  const generation = chatGeneration;
  const box = $('messages');
  const before = box.scrollHeight;
  const top = box.scrollTop;

  try {
    const rows = checked(
      await db
        .from('prsn_chat_messages')
        .select('*')
        .lt('id', Math.min(...messages.keys()))
        .order('id', { ascending: false })
        .limit(50)
    );

    if (generation !== chatGeneration) return;

    rows.forEach(row => messages.set(row.id, row));

    renderMessages();

    box.scrollTop = top + box.scrollHeight - before;
    $('older').hidden = rows.length < 50;
  } catch (error) {
    $('chatError').textContent = fail(error);
  } finally {
    loadingOlder = false;
    $('older').disabled = false;
  }
};

/* =========================
   SEND MESSAGE / ATTACHMENT
========================= */

$('chatFile').onchange = () => {
  $('selectedFile').textContent =
    $('chatFile').files[0]?.name || '';
};

$('messageForm').onsubmit = event => {
  event.preventDefault();

  busy(event.currentTarget, $('chatError'), async () => {
    const body = $('message').value.trim();
    const file = $('chatFile').files[0];

    if (!body && !file) return;

    const row = await insertWithFile(
      'prsn_chat_messages',
      'prsn-chat-files',
      {
        author_id: uid,
        author_name: userName,
        body
      },
      file
    );

    messages.set(row.id, row);
    renderMessages(true);

    $('message').value = '';
    $('chatFile').value = '';
    $('selectedFile').textContent = '';

    $('message').focus();
  });
};

$('closeChat').onclick = () => $('chatDialog').close();

$('chatDialog').addEventListener('close', () => {
  chatGeneration++;

  if (chatChannel) {
    db.removeChannel(chatChannel);
  }

  chatChannel = null;
});

/* =========================
   UPCOMING TESTS / HOMEWORK
========================= */

async function loadUpcoming() {
  if (preview) return;

  try {
    const now = new Date();

    const localToday = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0')
    ].join('-');

    const rows = checked(
      await db
        .from('prsn_study_posts')
        .select('id,title,subject,kind,due_date')
        .in('kind', ['prep', 'homework'])
        .gte('due_date', localToday)
        .order('due_date', { ascending: true })
        .limit(5)
    );

    $('upcomingList').replaceChildren();

    if (!rows.length) {
      $('upcomingList').append(
        node(
          'p',
          'Nothing scheduled yet. Add a date when you share a post.',
          'muted'
        )
      );
    }

    rows.forEach(row => {
      const item = node('div', undefined, 'upcoming-item');

      item.append(
        node('b', row.title),
        node(
          'small',
          dateText(row.due_date + 'T12:00:00') +
          ' · ' + row.subject
        )
      );

      $('upcomingList').append(item);
    });
  } catch {
    $('upcomingList').replaceChildren(
      node(
        'p',
        'Schedule unavailable. Refresh to retry.',
        'muted'
      )
    );
  }
}

/* =========================
   BACKGROUND STARS
========================= */

const particleCount =
  matchMedia('(max-width: 700px)').matches ? 28 : 60;

for (let i = 0; i < particleCount; i++) {
  const dot = node('span', undefined, 'particle');

  dot.style.left = Math.random() * 100 + '%';
  dot.style.top = Math.random() * 100 + '%';

  dot.style.setProperty(
    '--duration',
    5 + Math.random() * 9 + 's'
  );

  dot.style.animationDelay = -Math.random() * 12 + 's';

  $('particles').append(dot);
}

/* =========================
   SONG1.MP3
========================= */

const bgMusic = $('bgMusic');

bgMusic.volume = 0.18;

let musicPending = false;

function updateMusicButtons() {
  const playing = !bgMusic.paused && !bgMusic.ended;

  document.querySelectorAll('[data-music]').forEach(button => {
    button.setAttribute('aria-pressed', String(playing));

    button.setAttribute(
      'aria-label',
      playing
        ? 'Pause background music'
        : 'Play background music'
    );

    button.title = playing
      ? 'Pause background music'
      : 'Play background music';

    button.querySelector('span').textContent = playing
      ? 'Music on'
      : 'Music off';
  });
}

async function startMusic() {
  if (musicPending || !bgMusic.paused) return;

  musicPending = true;

  try {
    if (bgMusic.error) {
      bgMusic.load();
    }

    await bgMusic.play();
  } catch (error) {
    if (error.name === 'AbortError') return;

    toast(
      error.name === 'NotAllowedError'
        ? 'Tap Music again to allow audio playback.'
        : 'Song unavailable. Keep song1.mp3 beside index.html and refresh.'
    );
  } finally {
    musicPending = false;
    updateMusicButtons();
  }
}

document.querySelectorAll('[data-music]').forEach(button => {
  button.addEventListener('click', () => {
    if (musicPending || !bgMusic.paused) {
      bgMusic.pause();
    } else {
      startMusic();
    }
  });
});

bgMusic.addEventListener('play', updateMusicButtons);
bgMusic.addEventListener('pause', updateMusicButtons);
bgMusic.addEventListener('error', updateMusicButtons);

/* =========================
   GLOW + PERSONAL GREETING
   + FOCUS TIMER
========================= */

(() => {
  const el = id => document.getElementById(id);

  const reduced = matchMedia(
    '(prefers-reduced-motion: reduce)'
  );

  if (
    matchMedia('(hover:hover) and (pointer:fine)').matches &&
    !reduced.matches
  ) {
    let frame = 0;
    let x = 0;
    let y = 0;

    document.addEventListener('pointermove', event => {
      x = event.clientX;
      y = event.clientY;

      if (frame) return;

      frame = requestAnimationFrame(() => {
        el('cursorGlow').style.transform =
          `translate(${x - 200}px,${y - 200}px)`;

        el('cursorGlow').style.opacity = '1';
        frame = 0;
      });
    }, { passive: true });

    document.documentElement.addEventListener(
      'pointerleave',
      () => {
        el('cursorGlow').style.opacity = '0';
      }
    );
  }

  function greet() {
    const hour = new Date().getHours();

    const greeting = hour < 12
      ? 'Good morning'
      : hour < 17
        ? 'Good afternoon'
        : 'Good evening';

    const name = el('userName').textContent.trim();

    el('personalGreeting').textContent =
      `${greeting}${name ? ', ' + name : ''}. Your seat is ready.`;
  }

  new MutationObserver(greet).observe(el('app'), {
    attributes: true,
    attributeFilter: ['hidden']
  });

  greet();

  const duration = 25 * 60;
  const key = 'prsn-focus-v1';

  let remaining = duration;
  let end = null;
  let finished = false;

  try {
    const saved = JSON.parse(localStorage.getItem(key));

    if (
      saved &&
      Number.isFinite(saved.remaining) &&
      saved.remaining >= 0 &&
      saved.remaining <= duration
    ) {
      remaining = saved.remaining;

      if (
        Number.isFinite(saved.end) &&
        saved.end > 0 &&
        saved.end <= Date.now() + duration * 1000
      ) {
        end = saved.end;
      }

      finished = saved.finished === true;
    }
  } catch {}

  function save() {
    try {
      localStorage.setItem(
        key,
        JSON.stringify({ remaining, end, finished })
      );
    } catch {}
  }

  function paint() {
    const minutes = String(
      Math.floor(remaining / 60)
    ).padStart(2, '0');

    const seconds = String(
      remaining % 60
    ).padStart(2, '0');

    el('focusTime').textContent = `${minutes}:${seconds}`;

    el('focusRing').style.strokeDashoffset = String(
      333.01 * (1 - remaining / duration)
    );

    el('focusStart').textContent = end
      ? 'Pause focus Ⅱ'
      : finished
        ? 'Another sprint ↗'
        : remaining < duration
          ? 'Resume focus ↗'
          : 'Start focus ↗';

    const state = finished
      ? 'Done. Take a little break.'
      : end
        ? 'Just you and one chapter'
        : remaining < duration
          ? 'Paused. Take your time.'
          : 'Ready when you are';

    if (el('focusState').textContent !== state) {
      el('focusState').textContent = state;
    }

    el('focusHeading')
      .closest('section')
      .classList.toggle('complete', finished);
  }

  function tick() {
    if (end) {
      remaining = Math.min(
        duration,
        Math.max(0, Math.ceil((end - Date.now()) / 1000))
      );

      if (remaining === 0) {
        end = null;
        finished = true;
        save();
      }
    }

    paint();
  }

  el('focusStart').addEventListener('click', () => {
    tick();

    if (end) {
      end = null;
    } else {
      if (finished || remaining === 0) {
        remaining = duration;
      }

      finished = false;
      end = Date.now() + remaining * 1000;
    }

    save();
    paint();
  });

  el('focusReset').addEventListener('click', () => {
    end = null;
    remaining = duration;
    finished = false;

    save();
    paint();
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      tick();
      greet();
    }
  });

  setInterval(() => {
    if (!document.hidden) {
      tick();
    }
  }, 1000);

  tick();
})();

/* =========================
   FIVE-PAGE HINDI BOOK
========================= */

(() => {
  const pdfBase =
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/legacy/build/';

  const pageNames = [
    'Shyam & the book',
    'श्रुतिसम शब्द',
    'रसखान — सवैये',
    'कैदी और कोकिला',
    'Revision questions'
  ];

  const pageKey = 'prsn-hindi-page-v1';

  const dialog = $('bookDialog');
  const viewport = $('bookViewport');

  let pdf = null;
  let loading = null;
  let renderTask = null;

  let pageNumber = 1;
  let zoom = 1;
  let renderVersion = 0;
  let resizeTimer;

  try {
    const saved = Number(localStorage.getItem(pageKey));

    if (
      Number.isInteger(saved) &&
      saved >= 1 &&
      saved <= 5
    ) {
      pageNumber = saved;
    }
  } catch {}

  function controls() {
    const total = pdf?.numPages || 5;

    $('bookPageLabel').textContent =
      `Page ${pageNumber} / ${total}`;

    $('bookChapter').textContent =
      pageNames[pageNumber - 1] || `Page ${pageNumber}`;

    $('bookPrev').disabled = !pdf || pageNumber <= 1;
    $('bookNext').disabled = !pdf || pageNumber >= total;

    $('bookZoomOut').disabled = !pdf || zoom <= 1;
    $('bookZoomIn').disabled = !pdf || zoom >= 3;
    $('bookZoomReset').disabled = !pdf;

    $('bookZoomReset').textContent =
      `${Math.round(zoom * 100)}%`;

    document.querySelectorAll('[data-book-page]').forEach(
      button => {
        button.disabled = !pdf;

        if (Number(button.dataset.bookPage) === pageNumber) {
          button.setAttribute('aria-current', 'page');
        } else {
          button.removeAttribute('aria-current');
        }
      }
    );
  }

  function resumeLabel() {
    $('bookResume').textContent = pageNumber === 1
      ? 'Start with page 1 · Go at your own pace.'
      : `Continue from page ${pageNumber} · Saved on this device.`;
  }

  async function loadPDF() {
    if (pdf) return pdf;

    if (!loading) {
      loading = (async () => {
        const lib = await import(pdfBase + 'pdf.mjs');

        lib.GlobalWorkerOptions.workerSrc =
          pdfBase + 'pdf.worker.mjs';

        const task = lib.getDocument({
          url: 'hindi-test-book.pdf',
          isEvalSupported: false,
          useWasm: false
        });

        task.onProgress = progress => {
          if (dialog.open && !pdf && progress.total) {
            const percent = Math.min(
              100,
              Math.round(
                progress.loaded / progress.total * 100
              )
            );

            $('bookStatus').textContent =
              `Opening our book… ${percent}%`;
          }
        };

        try {
          pdf = await task.promise;
          return pdf;
        } catch (error) {
          task.destroy().catch(() => {});
          throw error;
        }
      })();
    }

    try {
      return await loading;
    } catch (error) {
      loading = null;
      throw error;
    }
  }

  async function renderPage() {
    if (!pdf || !dialog.open) return;

    const version = ++renderVersion;

    if (renderTask) {
      renderTask.cancel();
    }

    const requested = Math.max(
      1,
      Math.min(pdf.numPages, pageNumber)
    );

    pageNumber = requested;
    controls();

    $('bookCanvas').hidden = true;
    $('bookRetry').hidden = true;

    $('bookStatus').textContent =
      `Getting page ${requested} ready…`;

    viewport.setAttribute('aria-busy', 'true');

    try {
      const page = await pdf.getPage(requested);

      if (version !== renderVersion || !dialog.open) return;

      const base = page.getViewport({ scale: 1 });

      const width = Math.max(
        160,
        Math.min(800, viewport.clientWidth - 40)
      );

      const view = page.getViewport({
        scale: width / base.width * zoom
      });

      const density = Math.min(
        window.devicePixelRatio || 1,
        2,
        2500 / view.height
      );

      const canvas = document.createElement('canvas');

      canvas.id = 'bookCanvas';
      canvas.setAttribute('role', 'img');

      canvas.setAttribute(
        'aria-label',
        `Hindi book page ${requested}: ${
          pageNames[requested - 1] || ''
        }`
      );

      canvas.width = Math.ceil(view.width * density);
      canvas.height = Math.ceil(view.height * density);

      canvas.style.width = `${Math.floor(view.width)}px`;
      canvas.style.height = `${Math.floor(view.height)}px`;

      const task = page.render({
        canvasContext: canvas.getContext('2d'),
        viewport: view,
        transform: [density, 0, 0, density, 0, 0]
      });

      renderTask = task;

      await task.promise;

      if (version !== renderVersion || !dialog.open) return;

      $('bookCanvas').replaceWith(canvas);

      viewport.scrollTo(0, 0);
      $('bookStatus').textContent = '';

      try {
        localStorage.setItem(pageKey, String(requested));
      } catch {}

      resumeLabel();
    } catch (error) {
      if (
        version !== renderVersion ||
        !dialog.open ||
        error.name === 'RenderingCancelledException'
      ) {
        return;
      }

      $('bookStatus').textContent =
        'This page could not render. Retry, or use Open full PDF.';

      $('bookRetry').hidden = false;
    } finally {
      if (version === renderVersion) {
        renderTask = null;
        viewport.setAttribute('aria-busy', 'false');
      }
    }
  }

  async function openBook(requested) {
    if (Number.isInteger(requested)) {
      pageNumber = Math.max(1, Math.min(5, requested));
    }

    if (!dialog.open) {
      dialog.showModal();
    }

    controls();
    $('bookRetry').hidden = true;

    if (!pdf) {
      $('bookCanvas').hidden = true;
      $('bookStatus').textContent = 'Opening our book…';

      viewport.setAttribute('aria-busy', 'true');
    }

    try {
      await loadPDF();

      if (dialog.open) {
        await renderPage();
      }
    } catch {
      if (!dialog.open) return;

      $('bookStatus').textContent =
        location.protocol === 'file:'
          ? 'Use VS Code Live Server to open the reader, or choose Open full PDF.'
          : 'Book unavailable. Check your internet and keep hindi-test-book.pdf beside index.html.';

      $('bookRetry').hidden = false;
      viewport.setAttribute('aria-busy', 'false');
    }
  }

  function goTo(number) {
    if (!pdf) return;

    pageNumber = Math.max(
      1,
      Math.min(pdf.numPages, number)
    );

    renderPage();
  }

  document.querySelectorAll('[data-book-open]').forEach(
    button => {
      button.onclick = () => openBook(
        button.dataset.bookOpen
          ? Number(button.dataset.bookOpen)
          : pageNumber
      );
    }
  );

  document.querySelectorAll('[data-book-page]').forEach(
    button => {
      button.onclick = () => goTo(
        Number(button.dataset.bookPage)
      );
    }
  );

  $('bookPrev').onclick = () => goTo(pageNumber - 1);
  $('bookNext').onclick = () => goTo(pageNumber + 1);
  $('bookRetry').onclick = () => openBook(pageNumber);

  function changeZoom(next) {
    zoom = Math.max(1, Math.min(3, next));
    renderPage();
  }

  $('bookZoomIn').onclick = () => changeZoom(zoom + .25);
  $('bookZoomOut').onclick = () => changeZoom(zoom - .25);
  $('bookZoomReset').onclick = () => changeZoom(1);

  dialog.addEventListener('close', () => {
    renderVersion++;

    if (renderTask) {
      renderTask.cancel();
    }

    renderTask = null;
    viewport.setAttribute('aria-busy', 'false');
  });

  document.addEventListener('keydown', event => {
    if (
      !dialog.open ||
      !pdf ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey
    ) {
      return;
    }

    if (
      event.target.closest(
        'input,textarea,select,[contenteditable="true"]'
      )
    ) {
      return;
    }

    if (
      event.key === 'ArrowLeft' ||
      event.key === 'ArrowRight'
    ) {
      event.preventDefault();

      goTo(
        pageNumber +
        (event.key === 'ArrowLeft' ? -1 : 1)
      );
    }
  });

  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);

    resizeTimer = setTimeout(() => {
      if (dialog.open) {
        renderPage();
      }
    }, 180);
  });

  controls();
  resumeLabel();
})();
