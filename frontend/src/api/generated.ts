// Generated from backend/openapi.json; do not hand-edit.
// SHA-256: 30ef07fc76d3b7a1c696c92a92dc9d5cb01cef140518fb47f738958b338ca66a
export type Me = { readonly "id": string; readonly "displayName": string; readonly "email": string | null; readonly "csrfToken": string; readonly "storage": { readonly "usedBytes": 0; readonly "reservedBytes": 0; readonly "quotaBytes": 500000000; }; };
export type Error = { readonly "error": { readonly "code": string; readonly "message": string; readonly "requestId": string; }; };
export type Health = { readonly "status": "ok"; };
export type Project = { readonly "id": string; readonly "ownerUserId": string; readonly "name": string; readonly "tripCreationPolicy": "admins_only" | "all_project_members"; readonly "status": "active" | "archived" | "deletion_requested" | "deleted"; readonly "createdAt": string; };
export type ProjectCreate = { readonly "name": string; readonly "tripCreationPolicy"?: "admins_only" | "all_project_members"; };
export type Trip = { readonly "id": string; readonly "projectId": string; readonly "createdByUserId": string; readonly "name": string; readonly "description": string | null; readonly "status": "active" | "archived" | "deletion_requested" | "deleted"; readonly "createdAt": string; readonly "updatedAt": string; };
export type TripCreate = { readonly "name": string; readonly "description"?: string | null; };
export type Visit = { readonly "id": string; readonly "placeId": string; readonly "createdByUserId": string; readonly "name": string | null; readonly "status": "active" | "archived" | "deletion_requested" | "deleted"; readonly "updatedAt": string; readonly "tripId": string; readonly "place": Place; readonly "confirmedCoordinates": null; readonly "date": VisitDate; readonly "photoCount": 0; readonly "previewPhotoId": null; readonly "createdAt": string; };
export type Place = { readonly "id": string; readonly "countryCode": string; readonly "countryName": string; readonly "city": string; readonly "region": string | null; readonly "createdAt": string; readonly "approximateCoordinates": { readonly "lat": number; readonly "lng": number; } | null; readonly "source": { readonly "provider": string | null; readonly "id": string | null; readonly "url": string | null; }; };
export type VisitDate = { readonly "mode": "none"; readonly "start": null; readonly "end": null; } | { readonly "mode": "single"; readonly "start": string; readonly "end": string; } | { readonly "mode": "range"; readonly "start": string; readonly "end": string; };
export type VisitCreate = { readonly "placeId": string; readonly "name"?: string | null; readonly "date"?: VisitDate; readonly "confirmedCoordinates"?: null; };
export type VisitPatch = { readonly "placeId"?: string; readonly "name"?: string | null; readonly "date"?: VisitDate; readonly "confirmedCoordinates"?: null; };
export type MapMarker = { readonly "visitId": string; readonly "tripId": string; readonly "place": Place; readonly "confirmedCoordinates": null; readonly "date": VisitDate; readonly "photoCount": 0; readonly "previewPhotoId": null; readonly "createdAt": string; };
export type ProjectPage = { readonly "items": ReadonlyArray<Project>; readonly "nextCursor": string | null; };
export type TripPage = { readonly "items": ReadonlyArray<Trip>; readonly "nextCursor": string | null; };
export type VisitPage = { readonly "items": ReadonlyArray<Visit>; readonly "nextCursor": string | null; };
export type PlacePage = { readonly "items": ReadonlyArray<Place>; readonly "nextCursor": string | null; };
export type MapMarkerPage = { readonly "items": ReadonlyArray<MapMarker>; readonly "nextCursor": string | null; };
export interface ApiDtos { Me: Me; Error: Error; Health: Health; Project: Project; ProjectCreate: ProjectCreate; Trip: Trip; TripCreate: TripCreate; Visit: Visit; Place: Place; VisitDate: VisitDate; VisitCreate: VisitCreate; VisitPatch: VisitPatch; MapMarker: MapMarker; ProjectPage: ProjectPage; TripPage: TripPage; VisitPage: VisitPage; PlacePage: PlacePage; MapMarkerPage: MapMarkerPage; }
export const schemas = {
  "Me": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "format": "uuid"
      },
      "displayName": {
        "type": "string"
      },
      "email": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ]
      },
      "csrfToken": {
        "type": "string",
        "readOnly": true,
        "description": "Sensitive, bound to current session. Docs transport redacts this field and fetches it internally for mutations; never copy/log."
      },
      "storage": {
        "type": "object",
        "properties": {
          "usedBytes": {
            "type": "integer",
            "const": 0
          },
          "reservedBytes": {
            "type": "integer",
            "const": 0
          },
          "quotaBytes": {
            "type": "integer",
            "const": 500000000
          }
        },
        "required": [
          "usedBytes",
          "reservedBytes",
          "quotaBytes"
        ],
        "additionalProperties": false
      }
    },
    "required": [
      "id",
      "displayName",
      "email",
      "csrfToken",
      "storage"
    ],
    "additionalProperties": false
  },
  "Error": {
    "type": "object",
    "properties": {
      "error": {
        "type": "object",
        "properties": {
          "code": {
            "type": "string"
          },
          "message": {
            "type": "string"
          },
          "requestId": {
            "type": "string"
          }
        },
        "required": [
          "code",
          "message",
          "requestId"
        ],
        "additionalProperties": false
      }
    },
    "required": [
      "error"
    ],
    "additionalProperties": false
  },
  "Health": {
    "type": "object",
    "properties": {
      "status": {
        "const": "ok"
      }
    },
    "required": [
      "status"
    ],
    "additionalProperties": false
  },
  "Project": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "format": "uuid"
      },
      "ownerUserId": {
        "type": "string",
        "format": "uuid"
      },
      "name": {
        "type": "string"
      },
      "tripCreationPolicy": {
        "enum": [
          "admins_only",
          "all_project_members"
        ]
      },
      "status": {
        "enum": [
          "active",
          "archived",
          "deletion_requested",
          "deleted"
        ]
      },
      "createdAt": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "id",
      "ownerUserId",
      "name",
      "tripCreationPolicy",
      "status",
      "createdAt"
    ],
    "additionalProperties": false
  },
  "ProjectCreate": {
    "type": "object",
    "properties": {
      "name": {
        "type": "string",
        "minLength": 1,
        "maxLength": 200,
        "description": "Trimmed; no control characters. Unicode scalar character limit."
      },
      "tripCreationPolicy": {
        "enum": [
          "admins_only",
          "all_project_members"
        ],
        "default": "admins_only"
      }
    },
    "required": [
      "name"
    ],
    "additionalProperties": false
  },
  "Trip": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "format": "uuid"
      },
      "projectId": {
        "type": "string",
        "format": "uuid"
      },
      "createdByUserId": {
        "type": "string",
        "format": "uuid"
      },
      "name": {
        "type": "string"
      },
      "description": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ]
      },
      "status": {
        "enum": [
          "active",
          "archived",
          "deletion_requested",
          "deleted"
        ]
      },
      "createdAt": {
        "type": "string",
        "format": "date-time"
      },
      "updatedAt": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "id",
      "projectId",
      "createdByUserId",
      "name",
      "description",
      "status",
      "createdAt",
      "updatedAt"
    ],
    "additionalProperties": false
  },
  "TripCreate": {
    "type": "object",
    "properties": {
      "name": {
        "type": "string",
        "minLength": 1,
        "maxLength": 200,
        "description": "Trimmed; no control characters. Unicode scalar character limit."
      },
      "description": {
        "anyOf": [
          {
            "type": "string",
            "maxLength": 2000
          },
          {
            "type": "null"
          }
        ]
      }
    },
    "required": [
      "name"
    ],
    "additionalProperties": false
  },
  "Visit": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "format": "uuid"
      },
      "placeId": {
        "type": "string",
        "format": "uuid"
      },
      "createdByUserId": {
        "type": "string",
        "format": "uuid"
      },
      "name": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ]
      },
      "status": {
        "enum": [
          "active",
          "archived",
          "deletion_requested",
          "deleted"
        ]
      },
      "updatedAt": {
        "type": "string",
        "format": "date-time"
      },
      "tripId": {
        "type": "string",
        "format": "uuid"
      },
      "place": {
        "$ref": "#/components/schemas/Place"
      },
      "confirmedCoordinates": {
        "type": "null"
      },
      "date": {
        "$ref": "#/components/schemas/VisitDate"
      },
      "photoCount": {
        "type": "integer",
        "const": 0
      },
      "previewPhotoId": {
        "type": "null"
      },
      "createdAt": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "id",
      "placeId",
      "createdByUserId",
      "name",
      "status",
      "updatedAt",
      "tripId",
      "place",
      "confirmedCoordinates",
      "date",
      "photoCount",
      "previewPhotoId",
      "createdAt"
    ],
    "additionalProperties": false
  },
  "Place": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "format": "uuid"
      },
      "countryCode": {
        "type": "string",
        "pattern": "^[A-Z]{3}$"
      },
      "countryName": {
        "type": "string"
      },
      "city": {
        "type": "string"
      },
      "region": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ]
      },
      "createdAt": {
        "type": "string",
        "format": "date-time"
      },
      "approximateCoordinates": {
        "anyOf": [
          {
            "type": "object",
            "properties": {
              "lat": {
                "type": "number",
                "minimum": -90,
                "maximum": 90
              },
              "lng": {
                "type": "number",
                "minimum": -180,
                "maximum": 180
              }
            },
            "required": [
              "lat",
              "lng"
            ],
            "additionalProperties": false
          },
          {
            "type": "null"
          }
        ]
      },
      "source": {
        "type": "object",
        "properties": {
          "provider": {
            "anyOf": [
              {
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "id": {
            "anyOf": [
              {
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "url": {
            "anyOf": [
              {
                "type": "string",
                "format": "uri"
              },
              {
                "type": "null"
              }
            ]
          }
        },
        "required": [
          "provider",
          "id",
          "url"
        ],
        "additionalProperties": false
      }
    },
    "required": [
      "id",
      "countryCode",
      "countryName",
      "city",
      "region",
      "createdAt",
      "approximateCoordinates",
      "source"
    ],
    "additionalProperties": false
  },
  "VisitDate": {
    "oneOf": [
      {
        "type": "object",
        "properties": {
          "mode": {
            "const": "none"
          },
          "start": {
            "type": "null"
          },
          "end": {
            "type": "null"
          }
        },
        "required": [
          "mode",
          "start",
          "end"
        ],
        "additionalProperties": false
      },
      {
        "type": "object",
        "properties": {
          "mode": {
            "const": "single"
          },
          "start": {
            "type": "string",
            "format": "date"
          },
          "end": {
            "type": "string",
            "format": "date"
          }
        },
        "required": [
          "mode",
          "start",
          "end"
        ],
        "additionalProperties": false
      },
      {
        "type": "object",
        "properties": {
          "mode": {
            "const": "range"
          },
          "start": {
            "type": "string",
            "format": "date"
          },
          "end": {
            "type": "string",
            "format": "date"
          }
        },
        "required": [
          "mode",
          "start",
          "end"
        ],
        "additionalProperties": false
      }
    ],
    "description": "Calendar DATE, years0001–9999. Single: start=end. Range: start<=end. None: both null. Never timezone-convert."
  },
  "VisitCreate": {
    "type": "object",
    "properties": {
      "placeId": {
        "type": "string",
        "format": "uuid"
      },
      "name": {
        "anyOf": [
          {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
            "description": "Trimmed; no control characters. Unicode scalar character limit."
          },
          {
            "type": "null"
          }
        ]
      },
      "date": {
        "$ref": "#/components/schemas/VisitDate"
      },
      "confirmedCoordinates": {
        "type": "null"
      }
    },
    "required": [
      "placeId"
    ],
    "additionalProperties": false
  },
  "VisitPatch": {
    "type": "object",
    "properties": {
      "placeId": {
        "type": "string",
        "format": "uuid"
      },
      "name": {
        "anyOf": [
          {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
            "description": "Trimmed; no control characters. Unicode scalar character limit."
          },
          {
            "type": "null"
          }
        ]
      },
      "date": {
        "$ref": "#/components/schemas/VisitDate"
      },
      "confirmedCoordinates": {
        "type": "null"
      }
    },
    "required": [],
    "additionalProperties": false,
    "minProperties": 1
  },
  "MapMarker": {
    "type": "object",
    "properties": {
      "visitId": {
        "type": "string",
        "format": "uuid"
      },
      "tripId": {
        "type": "string",
        "format": "uuid"
      },
      "place": {
        "$ref": "#/components/schemas/Place"
      },
      "confirmedCoordinates": {
        "type": "null"
      },
      "date": {
        "$ref": "#/components/schemas/VisitDate"
      },
      "photoCount": {
        "type": "integer",
        "const": 0
      },
      "previewPhotoId": {
        "type": "null"
      },
      "createdAt": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "visitId",
      "tripId",
      "place",
      "confirmedCoordinates",
      "date",
      "photoCount",
      "previewPhotoId",
      "createdAt"
    ],
    "additionalProperties": false
  },
  "ProjectPage": {
    "type": "object",
    "properties": {
      "items": {
        "type": "array",
        "items": {
          "$ref": "#/components/schemas/Project"
        }
      },
      "nextCursor": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ]
      }
    },
    "required": [
      "items",
      "nextCursor"
    ],
    "additionalProperties": false
  },
  "TripPage": {
    "type": "object",
    "properties": {
      "items": {
        "type": "array",
        "items": {
          "$ref": "#/components/schemas/Trip"
        }
      },
      "nextCursor": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ]
      }
    },
    "required": [
      "items",
      "nextCursor"
    ],
    "additionalProperties": false
  },
  "VisitPage": {
    "type": "object",
    "properties": {
      "items": {
        "type": "array",
        "items": {
          "$ref": "#/components/schemas/Visit"
        }
      },
      "nextCursor": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ]
      }
    },
    "required": [
      "items",
      "nextCursor"
    ],
    "additionalProperties": false
  },
  "PlacePage": {
    "type": "object",
    "properties": {
      "items": {
        "type": "array",
        "items": {
          "$ref": "#/components/schemas/Place"
        }
      },
      "nextCursor": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ]
      }
    },
    "required": [
      "items",
      "nextCursor"
    ],
    "additionalProperties": false
  },
  "MapMarkerPage": {
    "type": "object",
    "properties": {
      "items": {
        "type": "array",
        "items": {
          "$ref": "#/components/schemas/MapMarker"
        }
      },
      "nextCursor": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ]
      }
    },
    "required": [
      "items",
      "nextCursor"
    ],
    "additionalProperties": false
  }
} as const;
