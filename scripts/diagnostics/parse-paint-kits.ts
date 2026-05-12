async function main() {
  const url = "https://raw.githubusercontent.com/SteamDatabase/GameTracking-CS2/master/game/csgo/pak01_dir/scripts/items/items_game.txt";
  const response = await fetch(url);
  const text = await response.text();
  
  const lines = text.split('\n');
  let inPaintKits = false;
  let currentKit = "";
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const trimmed = line.trim();
    if (trimmed.includes('"paint_kits"')) {
      inPaintKits = true;
    }
    
    if (inPaintKits) {
      if (trimmed.match(/^"\d+"/)) {
        currentKit = trimmed.replace(/"/g, '');
      }
      if (trimmed.includes('"name"')) {
        let name = trimmed.replace(/"name"/, '').replace(/"/g, '').trim();
        if (name.includes('am_doppler_phase') || name.includes('am_ruby') || name.includes('am_sapphire') || name.includes('am_blackpearl') || name.includes('am_emerald')) {
            console.log(`Paint Index: ${currentKit} -> Name: ${name}`);
        }
      }
    }
  }
}
main();
