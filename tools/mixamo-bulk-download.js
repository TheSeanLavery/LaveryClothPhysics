/**
 * Mixamo Bulk Animation Downloader
 *
 * Downloads all animations from our catalog in FBX format (no skin, 30fps).
 *
 * USAGE:
 *   1. Go to https://www.mixamo.com and log in (free account)
 *   2. Click on any character (e.g. "Y Bot" or upload your own)
 *   3. Open browser DevTools console (F12 → Console)
 *   4. Copy-paste this entire script and press Enter
 *   5. Wait — files download to your browser's download folder
 *   6. Move the downloaded .fbx files to public/assets/characters/mixamo/
 *
 * Based on gnuton's mixamo_anims_downloader.
 * See: https://gist.github.com/gnuton/ec2c3c2097f7aeaea8bb7d1256e4b212
 */

(() => {
  const bearer = localStorage.access_token;
  if (!bearer) {
    console.error('❌ Not logged in! Go to mixamo.com and log in first.');
    return;
  }

  // Our animation catalog — search term → desired filename
  const ANIMATIONS = [
    // idle
    { search: 'Breathing Idle', file: 'breathing-idle' },
    { search: 'Bored Idle', file: 'bored-idle' },
    { search: 'Idle Looking Around', file: 'idle-looking-around' },
    { search: 'Weight Shift', file: 'weight-shift-idle' },
    { search: 'Nervous Idle', file: 'nervous-idle' },
    // dance
    { search: 'Hip Hop Dancing', file: 'hip-hop-dancing' },
    { search: 'Samba Dancing', file: 'samba-dancing' },
    { search: 'Swing Dancing', file: 'swing-dancing' },
    { search: 'Macarena Dance', file: 'macarena-dance' },
    { search: 'Gangnam Style', file: 'gangnam-style' },
    { search: 'Robot Hip Hop Dance', file: 'robot-hip-hop-dance' },
    { search: 'House Dancing', file: 'house-dancing' },
    { search: 'Jazz Dancing', file: 'jazz-dancing' },
    { search: 'Chicken Dance', file: 'chicken-dance' },
    { search: 'Salsa Dancing', file: 'salsa-dancing' },
    { search: 'Belly Dancing', file: 'belly-dancing' },
    { search: 'Twist Dance', file: 'twist-dance' },
    { search: 'Breakdance', file: 'breakdance' },
    { search: 'Bboy Hip Hop Move', file: 'bboy-hip-hop-move' },
    { search: 'Flair', file: 'flair' },
    { search: 'Hokey Pokey', file: 'hokey-pokey' },
    { search: 'Rumba Dancing', file: 'rumba-dancing' },
    { search: 'Capoeira', file: 'capoeira' },
    { search: 'Wave Hip Hop Dance', file: 'wave-hip-hop-dance' },
    // walk
    { search: 'Walking', file: 'walking' },
    { search: 'Female Walk', file: 'female-walk' },
    { search: 'Catwalk Walk', file: 'catwalk-walk' },
    { search: 'Sneaking', file: 'sneaking-walk' },
    { search: 'Walking Backwards', file: 'walking-backwards' },
    { search: 'Strut Walk', file: 'strut-walking' },
    { search: 'Drunk Walk', file: 'drunk-walk' },
    { search: 'Sad Walk', file: 'sad-walk' },
    { search: 'Confident', file: 'confident-walk' },
    // run
    { search: 'Running', file: 'running' },
    { search: 'Jogging', file: 'jogging' },
    { search: 'Sprint', file: 'sprint' },
    { search: 'Jog Backwards', file: 'jog-backwards' },
    { search: 'Treadmill', file: 'treadmill-run' },
    // emote
    { search: 'Waving', file: 'waving' },
    { search: 'Salute', file: 'salute' },
    { search: 'Clapping', file: 'clapping' },
    { search: 'Cheering', file: 'cheering' },
    { search: 'Blowing A Kiss', file: 'blowing-a-kiss' },
    { search: 'Shrug', file: 'shrug' },
    { search: 'Head Nod Yes', file: 'head-nod-yes' },
    { search: 'Head Shake No', file: 'head-shake-no' },
    { search: 'Thumbs Up', file: 'thumbs-up' },
    { search: 'Pointing', file: 'pointing' },
    { search: 'Crying', file: 'crying' },
    { search: 'Laughing', file: 'laughing' },
    { search: 'Surprised', file: 'surprised' },
    { search: 'Thinking', file: 'thinking' },
    { search: 'Yawning', file: 'yawning' },
    // sit
    { search: 'Sitting Idle', file: 'sitting-idle' },
    { search: 'Sitting Clap', file: 'sitting-clap' },
    { search: 'Sitting Laughing', file: 'sitting-laughing' },
    { search: 'Sitting Talking', file: 'sitting-talking' },
    { search: 'Cheering While Sitting', file: 'cheering-while-sitting' },
    { search: 'Cross Legged Sitting', file: 'cross-legged-sitting' },
    // jump
    { search: 'Jumping', file: 'jumping' },
    { search: 'Jump Up', file: 'jump-up' },
    { search: 'Jumping Jacks', file: 'jumping-jacks' },
    { search: 'Cross Jumps', file: 'cross-jumps' },
    { search: 'Backflip', file: 'backflip' },
    { search: 'Cartwheel', file: 'cart-wheel' },
    // combat
    { search: 'Punching', file: 'punching' },
    { search: 'Kicking', file: 'kicking' },
    { search: 'Sword Slash', file: 'sword-slash' },
    { search: 'Boxing Idle', file: 'boxing-idle' },
    { search: 'Roundhouse Kick', file: 'roundhouse-kick' },
    { search: 'Uppercut', file: 'uppercut' },
    { search: 'Dodge', file: 'dodge' },
    { search: 'Getting Hit', file: 'getting-hit' },
    { search: 'Falling Down', file: 'falling-down' },
    { search: 'Standing Up', file: 'standing-up' },
    // exercise
    { search: 'Push Up', file: 'push-up' },
    { search: 'Arm Stretching', file: 'arm-stretching' },
    { search: 'Forward High Knees', file: 'forward-high-knees' },
    { search: 'Squats', file: 'squats' },
    { search: 'Sit Ups', file: 'sit-ups' },
    { search: 'Lunges', file: 'lunges' },
    // social
    { search: 'Talking', file: 'talking' },
    { search: 'Listening', file: 'listening' },
    { search: 'Arguing', file: 'arguing' },
    { search: 'Phone Talking', file: 'phone-talking' },
    { search: 'Handshake', file: 'handshake' },
    { search: 'Hugging', file: 'hugging' },
    // action
    { search: 'Typing', file: 'typing' },
    { search: 'Guitar Playing', file: 'guitar-playing' },
    { search: 'Singing', file: 'singing' },
    { search: 'Drinking', file: 'drinking' },
    { search: 'Looking Around', file: 'looking-around' },
    { search: 'Floating', file: 'floating' },
    { search: 'Praying', file: 'praying' },
    { search: 'Swimming', file: 'swimming' },
    { search: 'Climbing', file: 'climbing' },
    { search: 'Picking Up', file: 'picking-up' },
    // pose
    { search: 'Victory', file: 'victory-pose' },
    { search: 'Superhero Landing', file: 'superhero-landing' },
    { search: 'Model Pose', file: 'model-pose' },
    { search: 'Arms Crossed', file: 'arms-crossed' },
    { search: 'Hands On Hips', file: 'hands-on-hips' },
  ];

  const API_HEADERS = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${bearer}`,
    'X-Api-Key': 'mixamo2',
  };

  // Get the current character ID from the page URL or state
  const getCharacterId = async () => {
    // Try to get from page state
    const res = await fetch('https://www.mixamo.com/api/v1/characters', {
      headers: API_HEADERS,
    });
    const json = await res.json();
    if (json.results && json.results.length > 0) {
      return json.results[0].character_id;
    }
    throw new Error('No character found. Select/upload a character on mixamo.com first.');
  };

  // Search for an animation by name
  const searchAnimation = async (query) => {
    const url = `https://www.mixamo.com/api/v1/products?page=1&limit=10&order=&type=Motion&query=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: API_HEADERS });
    const json = await res.json();
    if (json.results && json.results.length > 0) {
      return json.results[0]; // Best match
    }
    return null;
  };

  // Get animation product details (needed for export)
  const getProductDetails = async (animId, characterId) => {
    const url = `https://www.mixamo.com/api/v1/products/${animId}?similar=0&character_id=${characterId}`;
    const res = await fetch(url, { headers: API_HEADERS });
    return res.json();
  };

  // Start export job
  const startExport = async (characterId, gmsHash, productName) => {
    const pvals = gmsHash.params.map((p) => p[1]).join(',');
    const body = {
      character_id: characterId,
      gms_hash: [{ ...gmsHash, params: pvals }],
      preferences: { format: 'fbx7', skin: 'false', fps: '30', reducekf: '0' },
      product_name: productName,
      type: 'Motion',
    };
    const res = await fetch('https://www.mixamo.com/api/v1/animations/export', {
      method: 'POST',
      headers: { ...API_HEADERS, 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify(body),
    });
    if (res.status === 429) {
      console.log('  ⏳ Rate limited, waiting 2s...');
      await new Promise((r) => setTimeout(r, 2000));
      return startExport(characterId, gmsHash, productName);
    }
    return res.json();
  };

  // Poll for export completion and get download URL
  const waitForExport = async (characterId) => {
    const url = `https://www.mixamo.com/api/v1/characters/${characterId}/monitor`;
    while (true) {
      const res = await fetch(url, { headers: API_HEADERS });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      const json = await res.json();
      if (json.status === 'completed') {
        return json.job_result; // Download URL
      }
      if (json.status === 'failed') {
        throw new Error(`Export failed: ${json.message}`);
      }
      // Still processing
      await new Promise((r) => setTimeout(r, 500));
    }
  };

  // Download a file by triggering browser download
  const triggerDownload = (url, filename) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Main download loop
  const run = async () => {
    console.log('🎬 Mixamo Bulk Downloader — Starting...');
    console.log(`📦 ${ANIMATIONS.length} animations to download\n`);

    let characterId;
    try {
      characterId = await getCharacterId();
      console.log(`✅ Character: ${characterId}\n`);
    } catch (e) {
      console.error(e.message);
      return;
    }

    let downloaded = 0;
    let failed = 0;
    const failures = [];

    for (const anim of ANIMATIONS) {
      const idx = ANIMATIONS.indexOf(anim) + 1;
      console.log(`[${idx}/${ANIMATIONS.length}] Searching: "${anim.search}"...`);

      try {
        const result = await searchAnimation(anim.search);
        if (!result) {
          console.log(`  ⚠️  Not found, skipping`);
          failed++;
          failures.push(anim.search);
          continue;
        }

        console.log(`  Found: "${result.description}" (${result.id})`);

        // Get product details for export params
        const product = await getProductDetails(result.id, characterId);
        const gmsHash = product.details.gms_hash;

        // Start export
        await startExport(characterId, gmsHash, anim.file);

        // Wait for completion
        const downloadUrl = await waitForExport(characterId);
        console.log(`  ⬇️  Downloading: ${anim.file}.fbx`);

        // Trigger browser download
        triggerDownload(downloadUrl, `${anim.file}.fbx`);
        downloaded++;

        // Small delay between downloads to avoid rate limits
        await new Promise((r) => setTimeout(r, 1500));
      } catch (e) {
        console.error(`  ❌ Failed: ${e.message}`);
        failed++;
        failures.push(anim.search);
      }
    }

    console.log('\n=============================');
    console.log(`✅ Downloaded: ${downloaded}`);
    console.log(`❌ Failed: ${failed}`);
    if (failures.length > 0) {
      console.log(`\nFailed animations:\n  ${failures.join('\n  ')}`);
    }
    console.log('\n📁 Move the .fbx files from your Downloads folder to:');
    console.log('   public/assets/characters/mixamo/');
    console.log('\nThen update animationCatalog.json — set "downloaded": true for each.');
  };

  run();
})();
