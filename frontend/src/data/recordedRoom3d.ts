// Recorded by backend/scripts/record_room3d.py; shop facts stay as captured.
import type { Session } from '../types'

export const RECORDED_ROOM: Session = {
  "id": "recorded-room-3d",
  "name": "Living room · recorded demo",
  "city": "Athens",
  "budgetEur": 700,
  "wallCm": null,
  "prompt": "A sofa and a floor lamp for this living room, under €700.",
  "group": "Earlier",
  "updatedLabel": "Recorded demo",
  "status": "done",
  "beforeSrc": "/demo3d/7258a975018a6227.jpg",
  "afterSrc": "/demo3d/ee078b197af50f91.jpg",
  "products": [
    {
      "id": "45437a1b6b194f15",
      "slot": "Sofa",
      "title": "Πολυμορφικός καναπές SKEJBY 3ατ. μπεζ ύφασμα",
      "retailer": "jysk.gr",
      "url": "https://jysk.gr/kathistiko/polymorfikoi-kanapedes/polymorfikos-kanapes-skejby-3at-mpez-yfasma",
      "priceEur": 599.0,
      "currency": "EUR",
      "widthCm": 254.0,
      "depthCm": 92.0,
      "heightCm": 64.0,
      "deliveryText": null,
      "box": {
        "x": 0.265,
        "y": 0.627,
        "w": 0.513,
        "h": 0.229
      },
      "thumb": {
        "src": "/demo3d/567c77391f238212.jpg"
      },
      "placed": true
    },
    {
      "id": "b44167b0392563c4",
      "slot": "Floor lamp",
      "title": "NYFORS φωτιστικό δαπέδου",
      "retailer": "ikea.gr",
      "url": "https://www.ikea.gr/proioda/nyfors-fwtistiko-dapedoy/90303106/",
      "priceEur": 95.0,
      "currency": "EUR",
      "widthCm": null,
      "depthCm": null,
      "heightCm": 168.0,
      "deliveryText": null,
      "box": {
        "x": 0.208,
        "y": 0.373,
        "w": 0.078,
        "h": 0.457
      },
      "thumb": {
        "src": "/demo3d/18083d3903f50bec.jpg"
      },
      "placed": true
    }
  ],
  "rejections": [],
  "alternatives": {},
  "ask": null,
  "now": null,
  "offer": true,
  "recorded3d": "/demo3d/scene.json",
  "chat": [
    {
      "role": "agent",
      "text": "Recorded 3D demo. These are saved shop listings and generated models, not a live shopping run. Prices are from the recording. Open the 3D view to explore the room and inspect each piece."
    }
  ]
}
