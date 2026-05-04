"""
Helios tech stack diagram (mingrammer/diagrams + Graphviz).

Build: python tech_stack.py
Output: tech_stack.png
"""
from pathlib import Path
import cairosvg
from PIL import Image, ImageDraw

from diagrams import Diagram, Cluster, Edge
from diagrams.custom import Custom

ROOT = Path(__file__).parent
ICONS = ROOT / "icons"
ICONS.mkdir(exist_ok=True)

SI_DIR = Path(r"C:\Users\rafam\onedrive\software\acm\Helios\frontend\node_modules\simple-icons\icons")

BRAND = {
    "nextjs":              ("nextdotjs.svg",            "#FFFFFF"),
    "express":             ("express.svg",              "#FFFFFF"),
    "anthropic":           ("anthropic.svg",            "#D97757"),
    "mcp":                 ("modelcontextprotocol.svg", "#FFC857"),
    "google":              ("google.svg",               "#4285F4"),
    "jwt":                 ("jsonwebtokens.svg",        "#FB015B"),
    "react":               ("react.svg",                "#61DAFB"),
    "typescript":          ("typescript.svg",           "#3178C6"),
    "tailwind":            ("tailwindcss.svg",          "#06B6D4"),
    "framer":              ("framer.svg",               "#0055FF"),
    "zod":                 ("zod.svg",                  "#3068B7"),
    "swagger":             ("swagger.svg",              "#85EA2D"),
    "mongoose":            ("mongoose.svg",             "#880000"),
    "mongodb":             ("mongodb.svg",              "#47A248"),
    "nodejs":              ("nodedotjs.svg",            "#5FA04E"),
}


def colorize_svg(svg_path: Path, hex_color: str) -> str:
    """Read an SVG, force its fill to a specific color."""
    raw = svg_path.read_text(encoding="utf-8")
    # simple-icons SVGs have a single <path> with no fill attr by default → it inherits.
    # Inject a fill on the <path> tags.
    return raw.replace("<path ", f'<path fill="{hex_color}" ')


def render_brand_pngs() -> None:
    for key, (svg_name, color) in BRAND.items():
        out = ICONS / f"{key}.png"
        if out.exists():
            continue
        src = SI_DIR / svg_name
        if not src.exists():
            print(f"[skip] {svg_name} not found")
            continue
        svg_str = colorize_svg(src, color)
        cairosvg.svg2png(bytestring=svg_str.encode("utf-8"),
                         write_to=str(out),
                         output_width=256, output_height=256,
                         background_color="rgba(0,0,0,0)")
        print(f"[ok] {key}.png")


def make_user_icon() -> None:
    out = ICONS / "user.png"
    if out.exists():
        return
    img = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((88, 40, 168, 120), fill="#FFC857")
    d.pieslice((48, 130, 208, 290), 180, 360, fill="#FFC857")
    img.save(out)
    print("[ok] user.png")


def make_jszip_icon() -> None:
    out = ICONS / "jszip.png"
    if out.exists():
        return
    img = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((40, 30, 216, 226), radius=18, fill="#FFD700", outline="#000", width=4)
    for i, y in enumerate(range(60, 200, 20)):
        x = 100 if i % 2 == 0 else 130
        d.rectangle((x, y, x + 30, y + 12), fill="#000")
    d.text((110, 200), "ZIP", fill="#000")
    img.save(out)
    print("[ok] jszip.png")


def make_target_api_icon() -> None:
    out = ICONS / "target.png"
    if out.exists():
        return
    img = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((28, 28, 228, 228), outline="#9aa3b2", width=6)
    for i in range(3):
        y = 80 + i * 40
        d.line((40, y, 216, y), fill="#9aa3b2", width=4)
    d.line((128, 30, 128, 226), fill="#9aa3b2", width=4)
    img.save(out)
    print("[ok] target.png")


# ----------------------------------------------------------------------
render_brand_pngs()
make_user_icon()
make_jszip_icon()
make_target_api_icon()


def ic(name: str) -> str:
    return str(ICONS / f"{name}.png")


graph_attr = {
    "fontsize": "20",
    "fontname": "Helvetica-Bold",
    "fontcolor": "#FFFFFF",
    "bgcolor": "#0a0a14",
    "splines": "spline",
    "pad": "0.5",
    "nodesep": "0.6",
    "ranksep": "1.2",
    "rankdir": "LR",
}
node_attr = {
    "fontcolor": "#FFFFFF",
    "fontname": "Helvetica",
    "fontsize": "12",
}
edge_attr = {
    "fontname": "Helvetica",
    "fontsize": "11",
    "fontcolor": "#FFC857",
}
cluster_attr_fe = {
    "bgcolor": "#0f1a24",
    "pencolor": "#61DAFB",
    "fontcolor": "#61DAFB",
    "fontname": "Helvetica-Bold",
    "fontsize": "13",
    "style": "rounded,dashed",
}
cluster_attr_be = {
    "bgcolor": "#0f1a14",
    "pencolor": "#5FA04E",
    "fontcolor": "#5FA04E",
    "fontname": "Helvetica-Bold",
    "fontsize": "13",
    "style": "rounded,dashed",
}
cluster_attr_auth = {
    "bgcolor": "#1a0f1a",
    "pencolor": "#FB015B",
    "fontcolor": "#FB015B",
    "fontname": "Helvetica-Bold",
    "fontsize": "13",
    "style": "rounded,dashed",
}

OUT = ROOT / "tech_stack"
SPINE = "#FFC857"

with Diagram(
    "Helios — Tech Stack",
    filename=str(OUT),
    show=False,
    direction="LR",
    outformat="png",
    graph_attr=graph_attr,
    node_attr=node_attr,
    edge_attr=edge_attr,
):
    user    = Custom("USER",                ic("user"))
    nextjs  = Custom("Next.js 16",          ic("nextjs"))
    express = Custom("Express · api.ts\nport 8000", ic("express"))
    claude  = Custom("Claude (Anthropic)",  ic("anthropic"))
    mcp     = Custom("MCP · server.ts\nport 3000", ic("mcp"))
    target  = Custom("User's Target API",   ic("target"))

    with Cluster("AUTH", graph_attr=cluster_attr_auth):
        google = Custom("Google OAuth", ic("google"))
        jwt    = Custom("JWT + bcrypt", ic("jwt"))
        google >> Edge(color="#7a8294", style="dashed") >> jwt

    with Cluster("FRONTEND  ·  renders with", graph_attr=cluster_attr_fe):
        react  = Custom("React 19",       ic("react"))
        ts     = Custom("TypeScript",     ic("typescript"))
        tw     = Custom("Tailwind v4",    ic("tailwind"))
        framer = Custom("Framer Motion",  ic("framer"))
        fe = [react, ts, tw, framer]

    with Cluster("BACKEND  ·  backed by", graph_attr=cluster_attr_be):
        zod      = Custom("Zod",            ic("zod"))
        swagger  = Custom("swagger-parser", ic("swagger"))
        mongoose = Custom("Mongoose",       ic("mongoose"))
        jszip    = Custom("JSZip",          ic("jszip"))
        node     = Custom("Node.js",        ic("nodejs"))
        mongodb  = Custom("MongoDB",        ic("mongodb"))
        mongoose >> Edge(color="#7a8294") >> mongodb
        be = [zod, swagger, mongoose, jszip, node]

    spine = Edge(color=SPINE, penwidth="2.5")
    user    >> Edge(label="click",          color=SPINE, penwidth="2.5") >> nextjs
    nextjs  >> Edge(label="fetch + JWT",    color=SPINE, penwidth="2.5") >> express
    express >> Edge(label="messages.create",color=SPINE, penwidth="2.5") >> claude
    claude  >> Edge(label="tool_use",       color=SPINE, penwidth="2.5") >> mcp
    mcp     >> Edge(label="HTTP",           color=SPINE, penwidth="2.5") >> target

    nextjs >> Edge(label="login",  color="#7a8294", style="dashed") >> google
    jwt    >> Edge(label="token",  color="#7a8294", style="dashed") >> express

    nextjs  >> Edge(color="#61DAFB", style="dashed") >> fe
    express >> Edge(color="#5FA04E", style="dashed") >> be

print("\n[done] wrote", OUT.with_suffix(".png"))
