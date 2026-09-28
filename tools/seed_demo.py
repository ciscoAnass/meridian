#!/usr/bin/env python3
"""Write a realistic demo calendar for screenshots/testing.

Usage: MERIDIAN_DATA_DIR=/tmp/demo python3 tools/seed_demo.py
"""
import datetime as dt
import json
import os
import uuid

out = os.environ.get("MERIDIAN_DATA_DIR") or "/tmp/meridian-demo"
os.makedirs(out, exist_ok=True)
today = dt.date.today()
monday = today - dt.timedelta(days=today.weekday())
cals = {
    "personal": {"id": "c-personal", "name": "Personal", "color": "#3F7BF0", "visible": True},
    "work": {"id": "c-work", "name": "Work", "color": "#F0604D", "visible": True},
    "health": {"id": "c-health", "name": "Health", "color": "#3DB36B", "visible": True},
    "family": {"id": "c-family", "name": "Family", "color": "#7466F0", "visible": True},
}
events = []


def add(cal, title, day, start=None, minutes=60, days=1, location="", rec=None, notes="", alerts=(10,)):
    d = monday + dt.timedelta(days=day)
    ev = {"id": uuid.uuid4().hex[:12], "calendarId": cals[cal]["id"], "title": title,
          "location": location, "notes": notes, "recurrence": rec, "exdates": [],
          "alerts": list(alerts), "created": "", "updated": ""}
    if start is None:
        ev.update(allDay=True, start=d.isoformat(), end=(d + dt.timedelta(days=days)).isoformat(), alerts=[])
    else:
        h, m = start
        s = dt.datetime.combine(d, dt.time(h, m))
        ev.update(allDay=False, start=s.strftime("%Y-%m-%dT%H:%M"),
                  end=(s + dt.timedelta(minutes=minutes)).strftime("%Y-%m-%dT%H:%M"))
    events.append(ev)


add("work", "Team standup", 0, (9, 30), 15, rec={"freq": "weekly", "interval": 1, "byDay": [1, 2, 3, 4, 5], "until": None, "count": None})
add("work", "Design review", 0, (11, 0), 90, location="Studio 3")
add("work", "Quarterly planning", 1, (10, 0), 120, location="Main boardroom", notes="Bring the roadmap draft.")
add("work", "1:1 with Elena", 1, (15, 0), 30)
add("personal", "Lunch with Marco", 2, (13, 30), 75, location="Casa Montaña")
add("health", "Morning run", 1, (7, 0), 45, rec={"freq": "weekly", "interval": 1, "byDay": [1, 3, 5], "until": None, "count": None})
add("work", "Product demo", 3, (16, 0), 60)
add("work", "Customer call", 3, (11, 30), 45, location="Video call")
add("work", "Customer call prep", 3, (11, 0), 30)
add("health", "Dentist", 4, (8, 30), 45, location="Clínica Ruzafa")
add("family", "Dinner at Mum’s", 5, (19, 30), 150)
add("personal", "Farmers’ market", 5, (10, 0), 90, location="Mercado Central")
add("family", "Lisbon weekend", 12, None, days=3)
add("personal", "Book club", 9, (19, 0), 90, rec={"freq": "monthly", "interval": 1, "byDay": None, "until": None, "count": None})
add("work", "Offsite", 16, None, days=2)
add("personal", "Yoga", 2, (18, 30), 60, rec={"freq": "weekly", "interval": 1, "byDay": [3], "until": None, "count": None})
add("family", "Ana’s birthday", 8, None, rec={"freq": "yearly", "interval": 1, "byDay": None, "until": None, "count": None})
add("work", "Sprint retro", 4, (14, 0), 60)
add("personal", "Pick up dry cleaning", 4, (17, 30), 15)
add("work", "Hiring panel", -5, (10, 0), 90)
add("personal", "Concert", -3, (21, 0), 120, location="Palau de la Música")
add("work", "Board update", 22, (9, 0), 60)
add("health", "Physio", 10, (8, 0), 45)
add("personal", "Flight to Lisbon", 11, (18, 40), 80, location="VLC → LIS")

data = {"version": 1, "calendars": list(cals.values()), "events": events, "meta": {}}
with open(os.path.join(out, "calendar.json"), "w") as fh:
    json.dump(data, fh, ensure_ascii=False)
print(f"wrote {len(events)} events to {out}")
