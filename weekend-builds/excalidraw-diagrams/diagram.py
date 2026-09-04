#!/usr/bin/env python3
"""Excalidraw Diagram Agent — describe any system, get an editable diagram.

    export ANTHROPIC_API_KEY=sk-ant-...
    python3 diagram.py "web app: browser -> load balancer -> 2 api servers -> postgres + redis"
    python3 diagram.py --demo        # render a built-in sample without an API call

Claude extracts a node/edge graph from your description (structured outputs,
so the JSON always validates); this script lays it out in layers and writes a
ready-to-edit .excalidraw file. Open it at https://excalidraw.com or in the
VS Code Excalidraw extension.
"""

from __future__ import annotations

import argparse
import json
import random
import re
import sys
import time
from collections import defaultdict
from pathlib import Path

MODEL = "claude-opus-4-8"

GRAPH_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "nodes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "short unique slug"},
                    "label": {"type": "string"},
                    "kind": {"type": "string",
                             "enum": ["service", "database", "queue", "client", "external"]},
                },
                "required": ["id", "label", "kind"],
                "additionalProperties": False,
            },
        },
        "edges": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "from": {"type": "string"},
                    "to": {"type": "string"},
                    "label": {"type": "string"},
                },
                "required": ["from", "to", "label"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["title", "nodes", "edges"],
    "additionalProperties": False,
}

DEMO_GRAPH = {
    "title": "Web app",
    "nodes": [
        {"id": "browser", "label": "Browser", "kind": "client"},
        {"id": "lb", "label": "Load balancer", "kind": "service"},
        {"id": "api1", "label": "API server 1", "kind": "service"},
        {"id": "api2", "label": "API server 2", "kind": "service"},
        {"id": "pg", "label": "PostgreSQL", "kind": "database"},
        {"id": "redis", "label": "Redis cache", "kind": "database"},
    ],
    "edges": [
        {"from": "browser", "to": "lb", "label": "HTTPS"},
        {"from": "lb", "to": "api1", "label": ""},
        {"from": "lb", "to": "api2", "label": ""},
        {"from": "api1", "to": "pg", "label": "SQL"},
        {"from": "api2", "to": "pg", "label": "SQL"},
        {"from": "api1", "to": "redis", "label": "cache"},
        {"from": "api2", "to": "redis", "label": "cache"},
    ],
}

COLORS = {  # stroke / background per node kind
    "client": ("#1971c2", "#d0ebff"),
    "service": ("#2f9e44", "#d3f9d8"),
    "database": ("#e8590c", "#ffe8cc"),
    "queue": ("#9c36b5", "#f3d9fa"),
    "external": ("#495057", "#e9ecef"),
}

NODE_W, NODE_H, GAP_X, GAP_Y = 190, 70, 130, 50


def extract_graph(description: str) -> dict:
    import anthropic

    client = anthropic.Anthropic()
    try:
        response = client.messages.create(
            model=MODEL,
            max_tokens=8192,
            thinking={"type": "adaptive"},
            system=("Extract the described system as a directed graph for an architecture "
                    "diagram. Every component becomes a node; every interaction an edge "
                    "(edge label may be an empty string). Use short readable labels."),
            messages=[{"role": "user", "content": description}],
            output_config={"format": {"type": "json_schema", "schema": GRAPH_SCHEMA}},
        )
    except anthropic.AuthenticationError:
        sys.exit("Set ANTHROPIC_API_KEY (get one at console.anthropic.com).")
    except anthropic.APIStatusError as exc:
        sys.exit(f"API error {exc.status_code}: {exc.message}")
    return json.loads("".join(b.text for b in response.content if b.type == "text"))


def layer_layout(graph: dict) -> dict[str, tuple[float, float]]:
    """Longest-path layering: roots in column 0, children to the right."""
    ids = [n["id"] for n in graph["nodes"]]
    out_edges = defaultdict(list)
    indegree = {i: 0 for i in ids}
    for e in graph["edges"]:
        if e["from"] in indegree and e["to"] in indegree:
            out_edges[e["from"]].append(e["to"])
            indegree[e["to"]] += 1

    layer = {i: 0 for i in ids}
    queue = [i for i in ids if indegree[i] == 0] or ids[:1]
    remaining = dict(indegree)
    while queue:
        node = queue.pop(0)
        for child in out_edges[node]:
            layer[child] = max(layer[child], layer[node] + 1)
            remaining[child] -= 1
            if remaining[child] == 0:
                queue.append(child)

    columns = defaultdict(list)
    for i in ids:
        columns[layer[i]].append(i)
    positions = {}
    for col, members in columns.items():
        total_h = len(members) * NODE_H + (len(members) - 1) * GAP_Y
        for row, node_id in enumerate(members):
            positions[node_id] = (col * (NODE_W + GAP_X),
                                  row * (NODE_H + GAP_Y) - total_h / 2)
    return positions


def element(**kwargs) -> dict:
    base = {
        "angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "transparent",
        "fillStyle": "solid", "strokeWidth": 2, "strokeStyle": "solid",
        "roughness": 1, "opacity": 100, "groupIds": [], "frameId": None,
        "roundness": None, "seed": random.randint(1, 2**31), "version": 1,
        "versionNonce": random.randint(1, 2**31), "isDeleted": False,
        "boundElements": None, "updated": int(time.time() * 1000),
        "link": None, "locked": False,
    }
    base.update(kwargs)
    return base


def text_element(text: str, cx: float, cy: float, size: int = 16, **extra) -> dict:
    width = max(len(line) for line in text.split("\n")) * size * 0.6
    height = size * 1.25 * len(text.split("\n"))
    return element(
        id=f"txt-{random.randint(1, 10**9)}", type="text",
        x=cx - width / 2, y=cy - height / 2, width=width, height=height,
        text=text, fontSize=size, fontFamily=1, textAlign="center",
        verticalAlign="middle", containerId=None, originalText=text,
        autoResize=True, lineHeight=1.25, **extra,
    )


def to_excalidraw(graph: dict) -> dict:
    positions = layer_layout(graph)
    elements = [text_element(graph["title"], 0, min(y for _, y in positions.values()) - 90,
                             size=24)]
    for node in graph["nodes"]:
        x, y = positions[node["id"]]
        stroke, bg = COLORS.get(node["kind"], COLORS["service"])
        shape_type = "ellipse" if node["kind"] == "database" else "rectangle"
        elements.append(element(
            id=f"node-{node['id']}", type=shape_type, x=x, y=y,
            width=NODE_W, height=NODE_H, strokeColor=stroke, backgroundColor=bg,
            roundness={"type": 3} if shape_type == "rectangle" else None,
        ))
        elements.append(text_element(node["label"], x + NODE_W / 2, y + NODE_H / 2,
                                     strokeColor=stroke))
    for edge in graph["edges"]:
        if edge["from"] not in positions or edge["to"] not in positions:
            continue
        x1, y1 = positions[edge["from"]]
        x2, y2 = positions[edge["to"]]
        start = (x1 + NODE_W, y1 + NODE_H / 2)
        end = (x2, y2 + NODE_H / 2)
        elements.append(element(
            id=f"edge-{edge['from']}-{edge['to']}-{random.randint(1, 10**6)}",
            type="arrow", x=start[0], y=start[1],
            width=abs(end[0] - start[0]), height=abs(end[1] - start[1]),
            points=[[0, 0], [end[0] - start[0], end[1] - start[1]]],
            lastCommittedPoint=None, startBinding=None, endBinding=None,
            startArrowhead=None, endArrowhead="arrow", strokeColor="#495057",
        ))
        if edge.get("label"):
            elements.append(text_element(edge["label"], (start[0] + end[0]) / 2,
                                         (start[1] + end[1]) / 2 - 14, size=12,
                                         strokeColor="#495057"))
    return {
        "type": "excalidraw",
        "version": 2,
        "source": "weekend-builds/excalidraw-diagrams",
        "elements": elements,
        "appState": {"viewBackgroundColor": "#ffffff", "gridSize": None},
        "files": {},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="System description → .excalidraw diagram.")
    parser.add_argument("description", nargs="?", help="What to diagram")
    parser.add_argument("--demo", action="store_true", help="Render a sample without the API")
    parser.add_argument("--out", type=Path, help="Output path (.excalidraw)")
    args = parser.parse_args()

    if args.demo:
        graph = DEMO_GRAPH
    elif args.description:
        graph = extract_graph(args.description)
    else:
        parser.error("give a description, or use --demo")

    slug = re.sub(r"[^a-z0-9]+", "-", graph["title"].lower()).strip("-") or "diagram"
    out = args.out or Path(f"{slug}.excalidraw")
    out.write_text(json.dumps(to_excalidraw(graph), indent=1), encoding="utf-8")
    print(f"{graph['title']}: {len(graph['nodes'])} nodes, {len(graph['edges'])} edges")
    print(f"Wrote {out} — open it at https://excalidraw.com")


if __name__ == "__main__":
    main()
