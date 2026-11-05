# Prompt: Add 0–12 month activities to RootMap MVP (51 activities)

You are working in the RootMap MVP repo (vegalh/rootmapmvp, deployed at vegalh.github.io/rootmapmvp). Add the 51 infant activities below to the app's activity content.

This prompt replaces an earlier version with 16 activities. If any of those were already added, update them in place rather than creating duplicates.

## Before writing anything
1. Find where activities are stored (data file, JSON, JS object, etc.) and read 2–3 existing entries.
2. Match the existing schema, field names, ID style, and tone exactly.
3. If the schema has no place for: age range, capacity tags, duration, home materials, preparation, safety note, or picture prompt, list the missing fields and propose the smallest schema change before adding them. Do not silently drop content.
4. If the app has bilingual (EN/中文) fields, fill both. Chinese names are given; translate steps faithfully.
5. Make sure the existing filters (age, duration, home materials) work with the new entries.
6. Run the app locally and confirm the new activities render and filter correctly. Then summarize what changed.

## Content rules (apply to every activity)
- **Direct aim** is always exactly: "To provide for the development of concentration, coordination, independence, and order." It is written once here and applies to every activity below; store it on every entry.
- **Presentation steps**: one action per step, imperative, never use "you" or "your". Example: "Wash hands."
- **Extensions**: more of the similar action, not a new skill.
- **Universal safety line on every activity:** "Never leave the child alone with these materials or during this activity." Each activity's safety field below starts with this line; store it in full, then the activity-specific note.
- Choking rule wherever small objects appear: anything that fits through a toilet-paper tube is a choking hazard under age 3.
- All text is original RootMap writing. Do not mention Gymboree or 金宝贝 anywhere. Songs are handled in a separate prompt; do not add song lyrics or audio here.
- Duration means a typical session. The child's cues end the activity: looking away, fussing, or tiring.

## Picture prompts
Every activity has a **picture prompt**. Store it in a `picturePrompt` field (or the closest existing field) so Vega can take or source a real photo to match. Use real photos, not videos.

Global photo style for all prompts: natural daylight, neutral and warm tones (cream, oak, linen), uncluttered floor-level setting, no brand logos, no screens, no plastic character toys, calm "Montessori meets Apple" feel. Show adult hands and arms only, with no adult faces. Show babies with their faces turned away or partly visible where possible.

---

# 0–3 months

### 1. High-Contrast Cards (黑白卡片)
- **Age:** 0–3 months · **Duration:** 2–5 min
- **Capacity:** Visual focus and tracking
- **Home materials:** Black-and-white shapes drawn or printed on stiff paper
- **Indirect aim:** Visual focus, eye tracking
- **Presentation:**
  1. Wash hands.
  2. Lay the baby on the back on a firm mat.
  3. Sit beside the baby.
  4. Hold one card 20–30 cm above the baby's face.
  5. Wait until the baby's eyes settle on the card.
  6. Move the card slowly to one side.
  7. Pause.
  8. Move the card slowly back to the center.
  9. Lower the card when the baby looks away.
- **Extensions:** Use a different card; move the card in a slow arc; place a card beside the mat at eye level during floor time.
- **Safety:** Never leave the child alone with these materials or during this activity. Keep paper edges away from the face.
- **Picture prompt:** Overhead shot of a newborn lying on a cream mat, gazing up at a black-and-white geometric card held by an adult hand about 25 cm above.

### 2. Naming Touch (说说小身体)
- **Age:** 0–6 months · **Duration:** 2–5 min (during diaper changes or dressing)
- **Capacity:** Body awareness, language
- **Home materials:** None
- **Indirect aim:** Body awareness, receptive language
- **Presentation:**
  1. Wash hands.
  2. Lay the baby on the back.
  3. Make eye contact.
  4. Touch the baby's hand gently.
  5. Say "hand."
  6. Pause.
  7. Touch the baby's foot gently.
  8. Say "foot."
  9. Pause.
  10. Continue with one body part at a time.
- **Extensions:** Name more body parts; name them on both sides (left hand, right hand); name them during bath time.
- **Safety:** Never leave the child alone with these materials or during this activity. Keep one hand on the baby on any raised changing surface.
- **Picture prompt:** Close-up of an adult hand gently touching a baby's bare foot on a soft linen surface.

### 3. Where's the Sound? (声音在哪里)
- **Age:** 0–4 months · **Duration:** 2–5 min
- **Capacity:** Listening, auditory localization
- **Home materials:** Wooden rattle, or a sound bottle (see #12)
- **Indirect aim:** Locating sound, head control
- **Presentation:**
  1. Wash hands.
  2. Lay the baby on the back.
  3. Hold the rattle out of sight on the baby's right side.
  4. Shake the rattle softly once.
  5. Wait for the baby's head or eyes to turn.
  6. Show the rattle.
  7. Move the rattle out of sight on the left side.
  8. Shake the rattle softly once.
  9. Wait.
- **Extensions:** Shake from above the head; shake from near the feet; use a softer sound.
- **Safety:** Never leave the child alone with these materials or during this activity. Keep sounds soft and never near the ear.
- **Picture prompt:** A baby on a mat turning the head toward a wooden rattle held low at the side by an adult hand.

### 4. Floor Mirror (镜子里的宝宝)
- **Age:** 0–12 months · **Duration:** 3–10 min
- **Capacity:** Self-awareness, head lifting, gross motor
- **Home materials:** Unbreakable (acrylic) mirror, firm mat
- **Indirect aim:** Self-awareness, neck and upper-body strength
- **Presentation:**
  1. Wash hands.
  2. Lean the mirror securely against a wall at floor level.
  3. Lay a firm mat in front of the mirror.
  4. Place the baby on the tummy facing the mirror.
  5. Sit beside the baby.
  6. Observe quietly.
  7. Lift the baby when tummy time ends.
- **Extensions:** Place the baby on the side facing the mirror; set the mirror at sitting height for older babies; sit beside the baby so both faces show in the mirror.
- **Safety:** Never leave the child alone with these materials or during this activity. Use acrylic only. Fix the mirror so it cannot tip.
- **Picture prompt:** A baby doing tummy time on a cream mat, lifting the head toward a low wall-mounted acrylic mirror; reflection softly visible.

### 5. Floating Scarf (飘飘的丝巾)
- **Age:** 0–6 months · **Duration:** 2–5 min
- **Capacity:** Visual tracking, touch
- **Home materials:** One lightweight silk or cotton scarf
- **Indirect aim:** Eye tracking, tactile awareness
- **Presentation:**
  1. Wash hands.
  2. Lay the baby on the back.
  3. Hold the scarf by one corner above the baby.
  4. Move the scarf slowly from side to side.
  5. Lower the scarf until it brushes the baby's hand.
  6. Lift the scarf.
  7. Fold the scarf away when the baby looks away.
- **Extensions:** Use a scarf of a different color; brush the scarf on the baby's foot; let the scarf drift down slowly onto the baby's tummy.
- **Safety:** Never leave the child alone with these materials or during this activity. Never place fabric over the baby's face. Put the scarf away after use.
- **Picture prompt:** A pale silk scarf drifting above a baby lying on a linen blanket, held at one corner by an adult hand.

### 6. Face Time (看看脸)
- **Age:** 0–3 months · **Duration:** 2–5 min
- **Capacity:** Social connection, imitation, visual focus
- **Home materials:** None
- **Indirect aim:** Early imitation, attention to faces
- **Presentation:**
  1. Wash hands.
  2. Hold the baby securely, face to face.
  3. Bring the face 20–30 cm from the baby's face.
  4. Wait for eye contact.
  5. Open the mouth slowly.
  6. Pause.
  7. Close the mouth slowly.
  8. Wait for the baby to respond.
  9. Repeat the expression.
- **Extensions:** Stick out the tongue slowly; smile slowly; raise the eyebrows slowly.
- **Safety:** Never leave the child alone with these materials or during this activity. Support the baby's head and neck at all times.
- **Picture prompt:** Side view of an adult holding a newborn face to face at close range, soft window light; adult face out of frame or softly blurred.

### 7. Talk-Back (你说我说)
- **Age:** 0–6 months · **Duration:** 2–5 min
- **Capacity:** Early communication, turn-taking
- **Home materials:** None
- **Indirect aim:** Conversational turn-taking, vocalization
- **Presentation:**
  1. Hold the baby face to face.
  2. Wait for the baby to coo.
  3. Repeat the baby's sound softly.
  4. Pause.
  5. Wait for the baby to make another sound.
  6. Repeat the new sound.
  7. Pause.
- **Extensions:** Add one new sound after the baby's sound; take turns for longer; take turns during feeding or dressing.
- **Safety:** Never leave the child alone with these materials or during this activity. Support the baby's head and neck at all times.
- **Picture prompt:** A baby lying on a lap, mouth open mid-coo, looking up toward an adult (adult face out of frame).

### 8. Window Watching (看窗外)
- **Age:** 0–6 months · **Duration:** 3–5 min
- **Capacity:** Visual tracking, language
- **Home materials:** A window
- **Indirect aim:** Watching movement, hearing names for things
- **Presentation:**
  1. Hold the baby upright against the shoulder.
  2. Walk to a window.
  3. Stand still.
  4. Wait for the baby to look out.
  5. Point to one moving thing.
  6. Name the thing.
  7. Pause.
  8. Point to another moving thing.
  9. Name the thing.
- **Extensions:** Visit a different window; watch at a different time of day; name the same things each day.
- **Safety:** Never leave the child alone with these materials or during this activity. Support the baby's head. Keep the baby away from blind cords and open windows.
- **Picture prompt:** View from behind of an adult holding a baby at a window, trees and soft daylight outside.

### 9. Rocking Song (摇摇歌)
- **Age:** 0–6 months · **Duration:** 3–5 min
- **Capacity:** Calming, rhythm, bonding
- **Home materials:** None (any public-domain tune)
- **Indirect aim:** Self-regulation, sense of rhythm
- **Presentation:**
  1. Sit in a steady chair.
  2. Hold the baby close to the chest.
  3. Support the baby's head.
  4. Begin to rock slowly.
  5. Begin to sing softly.
  6. Keep the rocking slow and even.
  7. Slow the rocking at the end of the song.
  8. Stop rocking.
- **Extensions:** Sing a different public-domain song; rock while standing and swaying; hum the tune without words.
- **Safety:** Never leave the child alone with these materials or during this activity. Rock slowly and gently; never shake.
- **Picture prompt:** An adult in a wooden rocking chair holding a sleepy baby against the chest, warm evening light.

### 10. Little Museum (小小博物馆)
- **Age:** 0–6 months · **Duration:** 3–10 min
- **Capacity:** Visual focus, curiosity
- **Home materials:** 2–3 art cards, a large leaf, a large shell, a wooden figure
- **Preparation:** Prop 2–3 items securely at the baby's eye level beside the mat. Swap one item each week.
- **Indirect aim:** Sustained looking, noticing change
- **Presentation:**
  1. Wash hands.
  2. Place the baby on the mat facing the display.
  3. Sit beside the baby.
  4. Point to one item.
  5. Name the item.
  6. Pause.
  7. Observe where the baby looks.
- **Extensions:** Swap in a new item; add an item with a new color; move the display to the other side of the mat.
- **Safety:** Never leave the child alone with these materials or during this activity. Prop items so they cannot fall on the baby. Keep display items out of reach unless they pass the choking rule.
- **Picture prompt:** A low display of a botanical art card, a large shell, and a leaf propped beside a baby on a cream mat, like a tiny gallery.

---

# 3–6 months

### 11. Something to Grasp (抓一抓)
- **Age:** 3–6 months · **Duration:** 3–5 min
- **Capacity:** Grasp, hand-eye coordination
- **Home materials:** Wooden or silicone ring (larger than a toilet-paper tube opening)
- **Indirect aim:** Voluntary grasp
- **Presentation:**
  1. Wash hands.
  2. Lay the baby on the back.
  3. Hold the ring near the baby's open hand.
  4. Touch the ring to the baby's palm.
  5. Wait.
  6. Release the ring when the baby grips it.
  7. Observe.
- **Extensions:** Offer the ring to the other hand; offer a ring of a different texture; offer the ring slightly higher so the baby reaches.
- **Safety:** Never leave the child alone with these materials or during this activity. Check the ring for cracks before each use.
- **Picture prompt:** A baby's small hand closing around a natural wooden ring; soft background.

### 12. Sound Bottles (声音瓶)
- **Age:** 3–12 months (adult shakes from 3 months; baby holds from about 6 months) · **Duration:** 3–10 min
- **Capacity:** Listening, sound discrimination, grasp
- **Home materials:** 3–4 identical small clear plastic bottles; dry beans, rice, small pasta; strong glue or tape
- **Preparation:** Fill each bottle a third full with a different filling. Glue each lid shut. Tape over the lid.
- **Indirect aim:** Listening, comparing sounds
- **Presentation:**
  1. Wash hands.
  2. Sit with the baby.
  3. Place the bottles on a tray.
  4. Pick up one bottle.
  5. Shake the bottle slowly.
  6. Pause.
  7. Set the bottle down.
  8. Pick up the next bottle.
  9. Shake the bottle slowly.
  10. Offer one bottle to the baby (6 months+).
  11. Return the bottles to the tray.
- **Extensions:** Add a bottle with a new filling; shake two bottles one after the other to compare; shake loud, then soft.
- **Safety:** Never leave the child alone with these materials or during this activity. Check lids are sealed before every use. Remove any cracked bottle at once.
- **Picture prompt:** Three small clear bottles filled with beans, rice and pasta on a wooden tray, a baby's hand reaching for one.

### 13. Just Out of Reach (够一够)
- **Age:** 4–7 months · **Duration:** 3–10 min
- **Capacity:** Reaching, gross motor, persistence
- **Home materials:** One favorite toy, firm mat
- **Indirect aim:** Reaching, rolling, early crawling
- **Presentation:**
  1. Wash hands.
  2. Place the baby on the tummy on the mat.
  3. Place one toy just beyond the baby's reach.
  4. Sit beside the baby.
  5. Observe quietly.
  6. Move the toy closer if the baby becomes frustrated.
- **Extensions:** Place the toy a little farther away; place the toy to one side; place the toy at a slight angle to encourage pivoting.
- **Safety:** Never leave the child alone with these materials or during this activity.
- **Picture prompt:** A baby on the tummy stretching one arm toward a wooden toy placed just out of reach on an oak floor.

### 14. Fabric Basket (摸摸布)
- **Age:** 4–9 months · **Duration:** 5–10 min
- **Capacity:** Touch, exploration
- **Home materials:** Shallow basket; 4–5 fabric scraps (cotton, wool, silk, corduroy, linen)
- **Indirect aim:** Tactile discrimination
- **Presentation:**
  1. Wash hands.
  2. Place the basket beside the baby.
  3. Take out one fabric.
  4. Brush the fabric over the baby's hand.
  5. Place the fabric in the baby's reach.
  6. Take out the next fabric.
  7. Observe.
  8. Return the fabrics to the basket.
- **Extensions:** Add a new texture; offer two fabrics side by side; use larger pieces to scrunch.
- **Safety:** Never leave the child alone with these materials or during this activity. Never place fabric over the face.
- **Picture prompt:** A low woven basket holding folded fabric swatches in natural tones beside a sitting baby.

### 15. Kick the Colors (踢彩色)
- **Age:** 3–6 months · **Duration:** 3–5 min
- **Capacity:** Leg strength, cause and effect, color
- **Home materials:** One bright soft ball or a bundle of colorful fabric
- **Indirect aim:** Purposeful kicking, body awareness
- **Presentation:**
  1. Wash hands.
  2. Lay the baby on the back on the mat.
  3. Sit at the baby's feet.
  4. Hold the colorful ball near the baby's feet.
  5. Wait for the baby to kick.
  6. Let the ball move when the baby's foot touches it.
  7. Pause.
  8. Hold the ball in place again.
- **Extensions:** Hold the ball a little higher; hold the ball to one side; use a ball of a different color.
- **Safety:** Never leave the child alone with these materials or during this activity. Do not use ribbons, strings, or anything that can wrap around the baby.
- **Picture prompt:** A baby on the back kicking bare feet toward a bright soft fabric ball held by an adult hand.

### 16. Hand to Hand (换手拿)
- **Age:** 4–7 months · **Duration:** 3–5 min
- **Capacity:** Hand coordination, crossing the midline
- **Home materials:** Ring or rattle
- **Indirect aim:** Passing an object from hand to hand
- **Presentation:**
  1. Wash hands.
  2. Sit the baby supported on the lap.
  3. Offer the ring to the baby's right hand.
  4. Wait for the baby to grasp the ring.
  5. Hold out an open hand near the baby's left hand.
  6. Wait.
  7. Observe the baby move the ring.
- **Extensions:** Start with the left hand; use a ring of a different size; use a ring of a different texture.
- **Safety:** Never leave the child alone with these materials or during this activity. Apply the choking rule to the ring.
- **Picture prompt:** A baby seated on a lap passing a wooden ring from one hand to the other.

### 17. Peekaboo (躲猫猫)
- **Age:** 4–12 months · **Duration:** 3–5 min
- **Capacity:** Object permanence, social play
- **Home materials:** One light cloth
- **Indirect aim:** Understanding that people still exist when hidden
- **Presentation:**
  1. Sit facing the baby.
  2. Make eye contact.
  3. Hold the cloth in front of the adult's own face.
  4. Pause.
  5. Lower the cloth slowly.
  6. Smile.
  7. Say "peekaboo."
  8. Pause.
- **Extensions:** Hide behind the hands; hide behind a door edge; wait a little longer before appearing.
- **Safety:** Never leave the child alone with these materials or during this activity. Cover only the adult's face, never the baby's.
- **Picture prompt:** An adult hand lowering a linen cloth from in front of an adult face, baby watching from a mat (adult face partly hidden by cloth).

### 18. Sound Copying (学声音)
- **Age:** 4–9 months · **Duration:** 3–5 min
- **Capacity:** Babbling, imitation, turn-taking
- **Home materials:** None
- **Indirect aim:** Vocal imitation
- **Presentation:**
  1. Sit facing the baby.
  2. Wait for the baby to make a sound.
  3. Repeat the sound.
  4. Pause.
  5. Wait for the baby to answer.
  6. Repeat the new sound.
  7. Pause.
- **Extensions:** Copy lip raspberries; copy "ba-ba" or "ma-ma" sounds; offer one new sound and wait for the baby to copy.
- **Safety:** Never leave the child alone with these materials or during this activity.
- **Picture prompt:** A baby blowing a raspberry while sitting on a soft rug, looking toward an adult just out of frame.

### 19. Real-Photo Book (看图画书)
- **Age:** 3–9 months · **Duration:** 3–5 min
- **Capacity:** Language, visual attention
- **Home materials:** Board book with real photos
- **Indirect aim:** Hearing names for real things
- **Presentation:**
  1. Sit with the baby on the lap.
  2. Hold the book open in front of the baby.
  3. Point to one photo.
  4. Name the photo.
  5. Pause.
  6. Turn the page slowly.
  7. Point to the next photo.
  8. Name the photo.
  9. Close the book when the baby looks away.
- **Extensions:** Read a different real-photo book; name the same photos each day; let the baby touch the page.
- **Safety:** Never leave the child alone with these materials or during this activity. Use board books only.
- **Picture prompt:** A baby on a lap looking at a board book open to a real photo of an apple; adult finger pointing.

---

# 6–9 months

### 20. Treasure Basket (宝藏篮)
- **Age:** 6–10 months · **Duration:** 10–20 min
- **Capacity:** Sensory exploration, concentration
- **Home materials:** Shallow basket; 6–8 safe everyday objects (wooden spoon, small metal whisk, small bowl, lemon, wooden ring, natural sponge)
- **Indirect aim:** Exploring weight, texture, temperature, and sound
- **Presentation:**
  1. Wash hands.
  2. Check each object for size and damage.
  3. Place the objects in the basket.
  4. Place the basket in front of the sitting baby.
  5. Sit nearby.
  6. Observe quietly.
  7. Return the objects to the basket when the baby finishes.
- **Extensions:** Change one object each week; group objects by material (all wood, all metal); add an object with a new sound.
- **Safety:** Never leave the child alone with these materials or during this activity. Apply the choking rule to every object.
- **Picture prompt:** A seated baby exploring a low basket of everyday objects: wooden spoon, small whisk, lemon, natural sponge.

### 21. Under the Cloth (藏起来了)
- **Age:** 6–10 months · **Duration:** 3–10 min
- **Capacity:** Object permanence, problem-solving
- **Home materials:** One small cloth, one familiar toy
- **Indirect aim:** Object permanence
- **Presentation:**
  1. Wash hands.
  2. Sit facing the baby.
  3. Place the toy in front of the baby.
  4. Cover half the toy with the cloth.
  5. Wait for the baby to pull the cloth.
  6. Cover the whole toy with the cloth.
  7. Wait.
  8. Fold the cloth away when the baby finishes.
- **Extensions:** Use a thicker cloth; hide the toy under one of two cloths; hide the toy while the baby watches, then wait longer.
- **Safety:** Never leave the child alone with these materials or during this activity.
- **Picture prompt:** A baby lifting a linen cloth to reveal a wooden toy underneath, adult hand resting nearby.

### 22. Little Music Basket (小小乐器篮)
- **Age:** 6–12 months · **Duration:** 5–10 min
- **Capacity:** Listening, rhythm, cause and effect
- **Home materials:** Basket; real small instruments such as an egg shaker, a small hand drum, a bell wristband, sound bottles (#12)
- **Indirect aim:** Making sound on purpose
- **Presentation:**
  1. Wash hands.
  2. Place the basket beside the baby.
  3. Take out one instrument.
  4. Play the instrument slowly.
  5. Pause.
  6. Offer the instrument to the baby.
  7. Observe.
  8. Return the instrument to the basket.
  9. Take out the next instrument.
- **Extensions:** Add a new instrument; play soft, then loud; play two instruments one after the other.
- **Safety:** Never leave the child alone with these materials or during this activity. Check for loose bells or small parts before each use. Remove any damaged instrument.
- **Picture prompt:** A woven basket holding a wooden egg shaker, a small hand drum, and a bell wristband beside a sitting baby.

### 23. Tissue Box Pull (抽丝巾)
- **Age:** 6–10 months · **Duration:** 5–10 min
- **Capacity:** Pincer grasp, persistence
- **Home materials:** Empty tissue box; 4–5 lightweight scarves
- **Preparation:** Tuck the scarves loosely into the box, one end of the top scarf showing.
- **Indirect aim:** Pulling, two-handed coordination
- **Presentation:**
  1. Wash hands.
  2. Place the box in front of the baby.
  3. Pull the first scarf slowly out of the box.
  4. Tuck the scarf back in.
  5. Wait for the baby to pull the scarf.
  6. Observe.
  7. Collect the scarves when the baby finishes.
- **Extensions:** Add more scarves; tie two scarves end to end; use scarves of different textures.
- **Safety:** Never leave the child alone with these materials or during this activity. Never put scarves around the neck. Put scarves away after use.
- **Picture prompt:** A baby pulling a soft colored scarf out of a plain tissue box, other scarves spilling onto a rug.

### 24. Box Tunnel (钻山洞)
- **Age:** 7–12 months · **Duration:** 5–10 min
- **Capacity:** Crawling, spatial awareness
- **Home materials:** Large cardboard box, open at both ends
- **Indirect aim:** Crawling through space, body awareness
- **Presentation:**
  1. Open both ends of the box.
  2. Lay the box on its side on the floor.
  3. Place the baby at one end.
  4. Move to the other end.
  5. Kneel down.
  6. Wait for the baby to look through.
  7. Wait for the baby to crawl through.
- **Extensions:** Use a longer box; place a toy in the middle; join two boxes.
- **Safety:** Never leave the child alone with these materials or during this activity. Remove staples and loose tape. Keep both ends open.
- **Picture prompt:** A baby crawling through a plain cardboard box tunnel on a wooden floor, light at the far end.

### 25. Sponge and Water Tray (海绵玩水)
- **Age:** 8–12 months · **Duration:** 5–10 min
- **Capacity:** Fine motor, sensory exploration
- **Home materials:** Baking tray, one sponge, one cup, towel
- **Preparation:** Pour about 2 cm of warm water into the tray. Lay a towel under the tray.
- **Indirect aim:** Squeezing, pouring
- **Presentation:**
  1. Wash hands.
  2. Place the tray on the towel.
  3. Sit the baby in front of the tray.
  4. Dip the sponge in the water.
  5. Lift the sponge.
  6. Squeeze the sponge slowly over the tray.
  7. Offer the sponge to the baby.
  8. Observe.
  9. Empty the tray when finished.
- **Extensions:** Add a second cup to pour into; use a larger sponge; squeeze water into the cup.
- **Safety:** Never leave the child alone with these materials or during this activity, not even for a moment. Empty the tray right after use.
- **Picture prompt:** A seated baby squeezing a natural sponge over a shallow tray of water, a cup beside it, towel underneath.

### 26. Nesting Cups (套杯)
- **Age:** 6–12 months · **Duration:** 5–10 min
- **Capacity:** Size comparison, hand-eye coordination
- **Home materials:** 3–4 measuring cups that fit inside each other
- **Indirect aim:** Comparing sizes
- **Presentation:**
  1. Wash hands.
  2. Place the cups in a row in front of the baby.
  3. Pick up the smallest cup.
  4. Place it inside the next cup.
  5. Pick up the pair.
  6. Place it inside the largest cup.
  7. Take the cups apart.
  8. Offer one cup to the baby.
- **Extensions:** Add one more cup; use bowls of different sizes; stack the cups upside down.
- **Safety:** Never leave the child alone with these materials or during this activity. Check cups for sharp edges.
- **Picture prompt:** A baby fitting one steel measuring cup inside another on a wooden floor.

### 27. Block Clap (对敲)
- **Age:** 7–10 months · **Duration:** 3–5 min
- **Capacity:** Two-handed coordination, rhythm
- **Home materials:** Two wooden blocks (larger than a toilet-paper tube opening)
- **Indirect aim:** Bringing both hands together at the center
- **Presentation:**
  1. Wash hands.
  2. Sit facing the baby.
  3. Hold one block in each hand.
  4. Tap the blocks together once.
  5. Pause.
  6. Tap the blocks together again.
  7. Offer the blocks to the baby.
  8. Observe.
- **Extensions:** Tap slowly, then faster; tap soft, then loud; tap a block on the floor.
- **Safety:** Never leave the child alone with these materials or during this activity. Apply the choking rule to the blocks.
- **Picture prompt:** A baby holding a natural wooden block in each hand, bringing them together.

### 28. Cushion Mountain (枕头山)
- **Age:** 8–12 months · **Duration:** 5–10 min
- **Capacity:** Crawling, climbing, balance
- **Home materials:** 2–3 firm sofa cushions
- **Indirect aim:** Crawling over uneven ground
- **Presentation:**
  1. Place the cushions in a low pile on a soft floor.
  2. Place the baby at one side.
  3. Move to the other side.
  4. Kneel down.
  5. Wait for the baby to crawl over.
  6. Observe.
- **Extensions:** Add one more cushion; space the cushions apart; place a toy on top.
- **Safety:** Never leave the child alone with these materials or during this activity. Keep the pile low. Keep the floor around it soft and clear.
- **Picture prompt:** A baby crawling over a low pile of linen sofa cushions on a rug.

### 29. Clap and Copy (拍拍手)
- **Age:** 7–12 months · **Duration:** 3–5 min
- **Capacity:** Imitation, social play
- **Home materials:** None
- **Indirect aim:** Copying actions
- **Presentation:**
  1. Sit facing the baby.
  2. Make eye contact.
  3. Clap the hands slowly.
  4. Pause.
  5. Wait for the baby to copy.
  6. Clap again.
  7. Pause.
- **Extensions:** Wave the hands; pat the knees; raise the arms high.
- **Safety:** Never leave the child alone with these materials or during this activity.
- **Picture prompt:** A seated baby clapping hands, facing an adult whose hands are mid-clap (adult face out of frame).

### 30. Family Photo Wall (认家人)
- **Age:** 6–12 months · **Duration:** 3–5 min
- **Capacity:** Recognition, language, belonging
- **Home materials:** Printed photos of family members, wide tape
- **Preparation:** Tape photos flat and low on the wall at the baby's eye level, edges fully taped.
- **Indirect aim:** Recognizing familiar people
- **Presentation:**
  1. Sit with the baby facing the wall.
  2. Point to one photo.
  3. Say the person's name.
  4. Pause.
  5. Point to the next photo.
  6. Say the person's name.
  7. Pause.
- **Extensions:** Add a new family photo; ask "where is grandma?" and wait; visit the wall each day.
- **Safety:** Never leave the child alone with these materials or during this activity. Use tape only, no pins or tacks.
- **Picture prompt:** A crawling baby touching family photos taped low on a white wall.

### 31. Leaf and Bark Touch (摸摸叶子)
- **Age:** 6–12 months · **Duration:** 5–10 min
- **Capacity:** Touch, nature, language
- **Home materials:** A tree, leaves, grass outdoors
- **Indirect aim:** Feeling natural textures
- **Presentation:**
  1. Carry the baby outdoors.
  2. Stand near a tree.
  3. Hold the baby's hand near the bark.
  4. Touch the bark gently with the baby's hand.
  5. Say "bark."
  6. Pause.
  7. Hold the baby's hand near a leaf.
  8. Touch the leaf gently with the baby's hand.
  9. Say "leaf."
  10. Wash the baby's hands afterward.
- **Extensions:** Touch grass; touch a smooth stone; visit a different tree.
- **Safety:** Never leave the child alone with these materials or during this activity. Avoid unknown or toxic plants. Keep plant parts out of the mouth.
- **Picture prompt:** A baby's hand resting on rough tree bark, an adult hand guiding it, green leaves around.

### 32. Scarf Dance (丝巾舞)
- **Age:** 6–12 months · **Duration:** 3–5 min
- **Capacity:** Movement, rhythm, visual tracking
- **Home materials:** 2 lightweight scarves, gentle music
- **Indirect aim:** Moving to music
- **Presentation:**
  1. Play soft music.
  2. Sit facing the baby.
  3. Hold a scarf in one hand.
  4. Wave the scarf slowly to the music.
  5. Offer the second scarf to the baby.
  6. Wave the scarf again.
  7. Observe.
  8. Collect the scarves when the music ends.
- **Extensions:** Wave the scarf up high; wave the scarf low; wave the scarf faster, then slower.
- **Safety:** Never leave the child alone with these materials or during this activity. Never put scarves around the neck. Put scarves away after use.
- **Picture prompt:** A seated baby holding a soft colored scarf aloft, another scarf mid-wave in an adult hand.

### 33. Smell Jars (闻一闻)
- **Age:** 6–12 months · **Duration:** 3–5 min
- **Capacity:** Smell, language
- **Home materials:** 3 small jars with lids, cotton balls, lemon peel, cinnamon stick, fresh mint
- **Preparation:** Place one scent in each jar with a cotton ball. Punch small holes in each lid. Glue each lid shut.
- **Indirect aim:** Noticing different smells
- **Presentation:**
  1. Wash hands.
  2. Sit with the baby on the lap.
  3. Pick up one jar.
  4. Hold the jar near the baby's nose.
  5. Name the smell.
  6. Pause.
  7. Set the jar down.
  8. Pick up the next jar.
- **Extensions:** Add a new scent; smell the real item afterward; compare two scents one after the other.
- **Safety:** Never leave the child alone with these materials or during this activity. The adult holds the jars. Use real foods and spices, not essential oils.
- **Picture prompt:** Three small glass jars with punched lids holding lemon peel, cinnamon and mint on a wooden tray.

### 34. Color Basket (颜色篮)
- **Age:** 6–12 months · **Duration:** 5–10 min
- **Capacity:** Color awareness, exploration
- **Home materials:** Basket; 5–6 safe household items all one color
- **Indirect aim:** Noticing color
- **Presentation:**
  1. Wash hands.
  2. Place the basket in front of the baby.
  3. Take out one item.
  4. Say the color.
  5. Place the item in reach.
  6. Take out the next item.
  7. Say the color.
  8. Observe.
- **Extensions:** Change the color each week; add a new item of the same color; use a different shade of the same color.
- **Safety:** Never leave the child alone with these materials or during this activity. Apply the choking rule to every item.
- **Picture prompt:** A woven basket of all-red items (red cup, red ball, red cloth, apple) beside a seated baby.

---

# 7–12 months

### 35. Unwrap the Toy (拆礼物)
- **Age:** 7–12 months · **Duration:** 5–10 min
- **Capacity:** Fine motor, problem-solving, persistence
- **Home materials:** Plain wrapping paper or tissue paper, one of the baby's own toys
- **Indirect aim:** Pincer grasp, two-handed coordination
- **Presentation:**
  1. Wash hands.
  2. Wrap the toy loosely in paper, with no tape.
  3. Place the wrapped toy in front of the baby.
  4. Pull one corner of the paper slowly.
  5. Pause.
  6. Wait for the baby to pull the paper.
  7. Observe.
  8. Collect the paper when the toy is found.
- **Extensions:** Wrap with one piece of tape; wrap in two layers; wrap a different toy.
- **Safety:** Never leave the child alone with these materials or during this activity. Collect all paper pieces afterward. Do not let the baby chew the paper.
- **Picture prompt:** A baby's hands tearing open plain kraft paper to reveal a familiar wooden toy, paper scraps on an oak floor.

### 36. Rolling Ball (滚球)
- **Age:** 7–12 months · **Duration:** 5–10 min
- **Capacity:** Tracking, turn-taking, gross motor
- **Home materials:** One soft fabric or rubber ball
- **Indirect aim:** Tracking a moving object, turn-taking
- **Presentation:**
  1. Wash hands.
  2. Sit facing the baby with legs apart.
  3. Roll the ball slowly to the baby.
  4. Wait.
  5. Hold out both hands.
  6. Wait for the baby to push the ball back.
  7. Roll the ball again.
- **Extensions:** Sit a little farther apart; use a smaller (still safe-size) ball; roll the ball slightly to one side.
- **Safety:** Never leave the child alone with these materials or during this activity.
- **Picture prompt:** An adult and baby sitting facing each other on a floor rug, a soft ball rolling between them.

### 37. Open the Box (打开盒子)
- **Age:** 8–12 months · **Duration:** 5–10 min
- **Capacity:** Fine motor, problem-solving, object permanence
- **Home materials:** Small cardboard box with a lift-off lid (e.g., a shoebox), one of the baby's own toys
- **Indirect aim:** Two-handed coordination, cause and effect
- **Presentation:**
  1. Wash hands.
  2. Place the toy in the box while the baby watches.
  3. Close the lid.
  4. Place the box in front of the baby.
  5. Lift the lid slowly.
  6. Show the toy.
  7. Close the lid.
  8. Wait for the baby to lift the lid.
- **Extensions:** Use a box with a tighter lid; use two boxes with the toy in one; use a box with a hinged flap.
- **Safety:** Never leave the child alone with these materials or during this activity. Remove staples and loose tape from the box.
- **Picture prompt:** A baby lifting the lid of a plain cardboard box to find a toy inside; soft daylight, neutral floor.

### 38. Posting Box (投一投)
- **Age:** 9–12 months · **Duration:** 5–15 min
- **Capacity:** Hand-eye coordination, concentration, object permanence
- **Home materials:** Box or tub with a round hole cut in the lid; 4–6 large balls or pom-poms (larger than a toilet-paper tube opening)
- **Indirect aim:** Hand-eye coordination, release
- **Presentation:**
  1. Wash hands.
  2. Place the box and the balls in front of the baby.
  3. Pick up one ball.
  4. Push the ball slowly through the hole.
  5. Pause.
  6. Lift the lid.
  7. Show the ball inside.
  8. Close the lid.
  9. Offer the next ball to the baby.
- **Extensions:** Add more balls; use a smaller (still safe-size) hole; use a box with two holes.
- **Safety:** Never leave the child alone with these materials or during this activity. Every piece must be larger than a toilet-paper tube opening.
- **Picture prompt:** A baby pushing a large felt ball through a round hole in a plain box lid.

### 39. In and Out (放进去，拿出来)
- **Age:** 9–12 months · **Duration:** 5–15 min
- **Capacity:** Order, repetition, grasp and release
- **Home materials:** Basket or bowl; 5–6 wooden blocks or large clothes-pegs
- **Indirect aim:** Grasp and release, sequencing
- **Presentation:**
  1. Wash hands.
  2. Place the empty basket and the blocks in front of the baby.
  3. Pick up one block.
  4. Place the block in the basket.
  5. Pick up the next block.
  6. Place the block in the basket.
  7. Tip the basket gently to empty it.
  8. Offer a block to the baby.
- **Extensions:** Use a container with a narrower opening; use more blocks; use a lidded container.
- **Safety:** Never leave the child alone with these materials or during this activity. Apply the choking rule to every piece.
- **Picture prompt:** A baby dropping wooden blocks into a woven basket, a few blocks scattered nearby on a neutral rug.

### 40. Push the Basket (推篮子)
- **Age:** 9–12 months · **Duration:** 5–10 min
- **Capacity:** Pulling to stand, early walking, strength
- **Home materials:** Sturdy laundry basket, a few heavy books
- **Preparation:** Place books in the basket so it does not tip.
- **Indirect aim:** Balance while walking with support
- **Presentation:**
  1. Clear a path on the floor.
  2. Place the weighted basket in front of the baby.
  3. Place the baby's hands on the basket rim.
  4. Kneel at the far end of the path.
  5. Wait for the baby to push.
  6. Observe.
- **Extensions:** Make the path longer; push on a rug, then a smooth floor; add one more book for steadiness.
- **Safety:** Never leave the child alone with these materials or during this activity. Keep the path clear of stairs, cords, and sharp corners.
- **Picture prompt:** A baby standing and pushing a woven laundry basket across a wooden floor.

### 41. Pull the String (拉绳子)
- **Age:** 9–12 months · **Duration:** 3–5 min
- **Capacity:** Cause and effect, problem-solving
- **Home materials:** One toy, one short string (under 30 cm)
- **Preparation:** Tie the string firmly to the toy.
- **Indirect aim:** Using a tool to bring something closer
- **Presentation:**
  1. Wash hands.
  2. Place the toy out of reach.
  3. Lay the string end near the baby.
  4. Pick up the string end.
  5. Pull the string slowly.
  6. Show the toy coming closer.
  7. Place the toy back out of reach.
  8. Offer the string end to the baby.
- **Extensions:** Place the toy a little farther away; use a different toy; pull the toy up onto a low step.
- **Safety:** Never leave the child alone with these materials or during this activity. Keep the string under 30 cm. Put it away after use.
- **Picture prompt:** A seated baby pulling a short cotton string attached to a wooden toy across the floor.

### 42. Lids On and Off (盖盖子)
- **Age:** 9–12 months · **Duration:** 5–10 min
- **Capacity:** Fine motor, problem-solving
- **Home materials:** 2–3 large plastic or wooden containers with lift-off lids
- **Indirect aim:** Matching lids, two-handed coordination
- **Presentation:**
  1. Wash hands.
  2. Place one container in front of the baby.
  3. Lift the lid off slowly.
  4. Set the lid down.
  5. Place the lid back on.
  6. Offer the container to the baby.
  7. Observe.
- **Extensions:** Add a second container; mix up two lids; use a container with a tighter lid.
- **Safety:** Never leave the child alone with these materials or during this activity. No glass. Apply the choking rule to all lids.
- **Picture prompt:** A baby lifting the lid off a round wooden container, a second container nearby.

### 43. Pour Between Bowls (倒一倒)
- **Age:** 9–12 months · **Duration:** 5–10 min
- **Capacity:** Hand control, cause and effect
- **Home materials:** Two bowls, 4–5 large wooden blocks
- **Indirect aim:** Tipping and pouring
- **Presentation:**
  1. Wash hands.
  2. Place both bowls in front of the baby.
  3. Fill one bowl with the blocks.
  4. Lift the full bowl.
  5. Tip the blocks slowly into the empty bowl.
  6. Set the bowl down.
  7. Offer the full bowl to the baby.
- **Extensions:** Use more blocks; use bowls of different sizes; pour into a basket.
- **Safety:** Never leave the child alone with these materials or during this activity. Apply the choking rule to every piece.
- **Picture prompt:** A baby tipping wooden blocks from one wooden bowl into another.

### 44. Wave Bye-Bye (挥手再见)
- **Age:** 9–12 months · **Duration:** 1–2 min, during daily routines
- **Capacity:** Social gestures, imitation
- **Home materials:** None
- **Indirect aim:** Using a gesture to communicate
- **Presentation:**
  1. Hold the baby at the door.
  2. Face the departing person.
  3. Raise one hand.
  4. Wave slowly.
  5. Say "bye-bye."
  6. Pause.
  7. Wait for the baby to wave.
- **Extensions:** Wave hello when someone arrives; wave to a pet; wave from a window.
- **Safety:** Never leave the child alone with these materials or during this activity.
- **Picture prompt:** A baby on an adult's hip waving at an open front door.

### 45. First Scribble (第一次涂鸦)
- **Age:** 10–12 months · **Duration:** 3–10 min
- **Capacity:** Grasp, cause and effect, early mark-making
- **Home materials:** One chunky non-toxic crayon, large paper, tape
- **Preparation:** Tape the paper flat to the floor or a low table.
- **Indirect aim:** Making a mark on purpose
- **Presentation:**
  1. Wash hands.
  2. Sit the baby in front of the paper.
  3. Hold the crayon.
  4. Draw one slow line.
  5. Set the crayon down.
  6. Offer the crayon to the baby.
  7. Observe.
  8. Put the crayon away when finished.
- **Extensions:** Use a different color; use a larger sheet; tape paper to a low wall.
- **Safety:** Never leave the child alone with these materials or during this activity. Use chunky non-toxic crayons only. Keep crayons out of the mouth.
- **Picture prompt:** A baby gripping a chunky crayon, making a first mark on large white paper taped to the floor.

### 46. Sock Helper (放袜子)
- **Age:** 10–12 months · **Duration:** 3–5 min
- **Capacity:** Practical life, belonging, grasp and release
- **Home materials:** Laundry basket, a few clean socks
- **Indirect aim:** Contributing to household work
- **Presentation:**
  1. Place the laundry basket beside the baby.
  2. Place a few socks on the floor.
  3. Pick up one sock.
  4. Drop the sock in the basket.
  5. Say "in."
  6. Offer a sock to the baby.
  7. Observe.
- **Extensions:** Add more socks; add small towels; carry one sock to the basket together.
- **Safety:** Never leave the child alone with these materials or during this activity.
- **Picture prompt:** A baby dropping a small sock into a woven laundry basket.

### 47. Kitchen Drawer (拿出来)
- **Age:** 9–12 months · **Duration:** 5–15 min
- **Capacity:** Exploration, independence, grasp and release
- **Home materials:** One low drawer or cupboard with safe kitchen items (wooden spoons, plastic containers, cloth napkins)
- **Preparation:** Remove sharp, glass, heavy, and small items. Fit a drawer stop if the drawer can fall out.
- **Indirect aim:** Exploring a real household space
- **Presentation:**
  1. Open the drawer.
  2. Sit the baby in front of the drawer.
  3. Take out one item.
  4. Name the item.
  5. Place the item on the floor.
  6. Observe.
  7. Put the items back together when finished.
- **Extensions:** Change one item each week; add a new safe item; put items back in the drawer together.
- **Safety:** Never leave the child alone with these materials or during this activity. Check the drawer for pinch points.
- **Picture prompt:** A baby sitting at a low kitchen drawer, pulling out a wooden spoon, containers on the floor.

### 48. Point and Name (指一指)
- **Age:** 9–12 months · **Duration:** 3–5 min
- **Capacity:** Pointing, language
- **Home materials:** Board book with clear real-object pictures
- **Indirect aim:** Joint attention, pointing
- **Presentation:**
  1. Sit with the baby on the lap.
  2. Open the book.
  3. Point to one picture.
  4. Name the picture.
  5. Pause.
  6. Wait for the baby to point.
  7. Name what the baby points to.
  8. Turn the page.
- **Extensions:** Ask "where is the dog?" and wait; point to the same things in the room; read a different book.
- **Safety:** Never leave the child alone with these materials or during this activity. Use board books only.
- **Picture prompt:** A baby's finger pointing at a picture in an open board book on an adult's lap.

### 49. Ball Down a Ramp (滚坡)
- **Age:** 9–12 months · **Duration:** 5–10 min
- **Capacity:** Cause and effect, visual tracking
- **Home materials:** A smooth board or large book, a cushion to prop it, one ball
- **Preparation:** Prop one end of the board on the cushion to make a gentle slope.
- **Indirect aim:** Watching how objects move
- **Presentation:**
  1. Place the ramp in front of the baby.
  2. Hold the ball at the top of the ramp.
  3. Let go of the ball.
  4. Watch the ball roll down.
  5. Pick up the ball.
  6. Offer the ball to the baby.
  7. Observe.
- **Extensions:** Make the slope a little steeper; use a different ball; roll two balls one after the other.
- **Safety:** Never leave the child alone with these materials or during this activity. Make sure the ramp is stable. Apply the choking rule to the ball.
- **Picture prompt:** A ball rolling down a wooden board propped on a cushion, a baby watching from the bottom.

### 50. Rings on a Pole (套圈圈)
- **Age:** 9–12 months · **Duration:** 5–10 min
- **Capacity:** Hand-eye coordination, concentration
- **Home materials:** Upright paper-towel holder, 3–4 large wooden rings
- **Indirect aim:** Taking off and placing on
- **Presentation:**
  1. Wash hands.
  2. Place the holder in front of the baby.
  3. Place the rings on the pole.
  4. Lift one ring off slowly.
  5. Set the ring down.
  6. Offer the pole to the baby.
  7. Observe.
  8. Place one ring back on the pole.
- **Extensions:** Add one more ring; use rings of different sizes; put rings back on together.
- **Safety:** Never leave the child alone with these materials or during this activity. Use a heavy, stable holder. Apply the choking rule to the rings.
- **Picture prompt:** A baby lifting a wooden ring off an upright wooden paper-towel holder.

### 51. Barefoot Textures (光脚踩踩)
- **Age:** 9–12 months · **Duration:** 5–10 min
- **Capacity:** Balance, touch, body awareness
- **Home materials:** Different surfaces: grass, a rug, a towel
- **Preparation:** Check each surface for sharp objects and temperature.
- **Indirect aim:** Feeling the ground through the feet
- **Presentation:**
  1. Remove the baby's shoes and socks.
  2. Hold the baby under the arms.
  3. Stand the baby on the first surface.
  4. Name the surface.
  5. Pause.
  6. Lift the baby.
  7. Stand the baby on the next surface.
  8. Name the surface.
- **Extensions:** Add a new surface; let the baby cruise across two surfaces; stand longer on each one.
- **Safety:** Never leave the child alone with these materials or during this activity. Avoid hot, cold, or rough surfaces.
- **Picture prompt:** Close-up of a baby's bare feet standing on soft grass, supported by adult hands.
