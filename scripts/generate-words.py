#!/usr/bin/env python3
"""Generate the fixed adjective and noun lists used by readableName().

The lists must hold exactly 256 entries each and never change: a changed list
changes every readable name in every existing trace. Run once, commit the
output, and treat packages/core/src/naming/words.ts as frozen.

    python3 scripts/generate-words.py
"""

from pathlib import Path

ADJECTIVES = """
amber ancient arctic ashen autumn azure balmy bitter blazing blithe bold boreal
brave brief bright brisk broad bronze buoyant calm candid careful chilly civic
classic clean clear clever cloudy coastal cobalt cold cool copper coral cosmic
crimson crisp curious daily damp dapper daring dark dawn deep dense dewy distant
divine drifting dry dusky dusty eager early earthy eastern easy elder electric
elegant empty endless equal even exact fabled faded faint fair fallen famous
fancy fast fearless fertile fierce fiery final firm first flat fleet floral
flowing fluent foggy fond forest formal fragrant free fresh frigid frosty frozen
gallant gentle giant gilded glad gleaming glowing golden graceful grand granite
grassy great green hardy harsh hazy healthy heavy hidden high hollow honest
hopeful humble hushed icy idle indigo inland inner iron ivory jade jagged jolly
joyful keen kind lasting late lavender lean level light lilac little lively
lofty lone long loud lower loyal lucid lucky lunar marble mellow merry mighty
mild minor misty modern modest molten mossy muted narrow native neat new nimble
noble northern novel oaken olive open opal orange outer pale patient peaceful
pearl plain pleasant plum polar polished prime proud pure purple quaint quick
quiet radiant rapid rare ready restless rich rising roaming rosy rough round
royal ruby rugged rustic sable sacred saffron sage salty sandy scarlet secret
serene shaded shallow sharp sheer shining short silent silken silver simple
sleek slender slight small smooth snowy soaring soft solar solemn solid somber
sound southern sparse spirited spring stark steady steep stellar stern still
stormy stout strong sturdy subtle sunlit sunny supple swift tall tame tangled
teal tender tepid thawing thin thorough tidal tidy timber timely tiny towering
tranquil true twilight umber upper urban vacant valiant velvet verdant vermilion
vigilant violet vivid warm watchful weathered western wet whispering white wide
wild willing windy winding winter wise wooded woven yellow young zealous zesty
"""

NOUNS = """
acorn alcove anchor anvil arbor arch archer arrow ash aspen atlas aurora badger
banner basin bay beacon beam bear beech bell bench birch bison blade bloom bluff
boulder bramble branch brass breeze bridge brook buffalo burrow cabin cairn
canal candle canopy canyon cape cardinal cascade castle cavern cedar chapel
chart chasm chestnut cliff clover coast comet compass copse coral cove crane
crater creek crest crocus crow crown crystal cypress dale dawn deer delta den
dial dome dove dune dusk eagle echo eddy elm ember estuary falcon fawn fern
ferry field finch fjord flame flare fleet flint flock ford forest forge fountain
fox frost gale garden gate geode geyser glacier glade glen grove gull gully
hammer harbor harvest hawk haven hazel headland hearth heath hedge heron hill
hollow horizon hound ibis inlet iris islet ivy jetty juniper keel kestrel key
kite lagoon lake lantern larch lark ledge lichen lily linden lodge loft loom
lookout lotus lynx maple marsh martin meadow mesa mill mint mist moor moss
mountain mouse narwhal nest nettle nook oak oasis oriole otter outcrop owl palm
pass pasture path peak pearl pebble pelican petal pier pigeon pike pillar pine
pinnacle plain plateau plover pond poplar prairie quarry quill quilt rabbit
raven reach reed reef ridge rill river robin rook root rowan rush sable sage
sail sanctuary sand sapling savanna sedge shale shelf shore shrike sierra slope
snipe sparrow spire spring spruce stag stalk star steppe stone stream summit
swallow swan sycamore tarn teal temple terrace thicket thorn thrush tide timber
torrent tower trail tundra tunnel turret vale valley vane vault vine vista vole
warren waterfall wave weald well wharf willow window wolf wood wren yard yarrow
yew
"""


def build(raw: str, label: str) -> list[str]:
    words = sorted(set(raw.split()))
    if len(words) < 256:
        raise SystemExit(f"{label}: need 256 unique words, have {len(words)}")
    return words[:256]


def main() -> None:
    adjectives = build(ADJECTIVES, "adjectives")
    nouns = build(NOUNS, "nouns")

    def render(name: str, words: list[str]) -> str:
        lines = []
        for i in range(0, len(words), 6):
            chunk = ", ".join(f"'{w}'" for w in words[i : i + 6])
            lines.append(f"  {chunk},")
        body = "\n".join(lines)
        return f"export const {name}: readonly string[] = [\n{body}\n];"

    out = Path(__file__).resolve().parents[1] / "packages/core/src/naming/words.ts"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        "// Generated by scripts/generate-words.py. Frozen: editing these lists\n"
        "// changes the readable name of every element in every existing trace.\n"
        "\n"
        f"{render('ADJECTIVES', adjectives)}\n"
        "\n"
        f"{render('NOUNS', nouns)}\n"
    )
    print(f"wrote {out} ({len(adjectives)} adjectives, {len(nouns)} nouns)")


if __name__ == "__main__":
    main()
