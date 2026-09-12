module.exports = [
  {
    type: "heading",
    defaultValue: "Rainradar"
  },
  {
    type: "section",
    items: [
      {
        type: "heading",
        defaultValue: "Location"
      },
      {
        type: "select",
        messageKey: "LocMode",
        label: "Mode",
        defaultValue: "gps",
        options: [
          { label: "Phone GPS", value: "gps" },
          { label: "Fixed location", value: "fixed" }
        ]
      },
      {
        type: "input",
        messageKey: "Lat",
        defaultValue: "51.5074",
        label: "Latitude",
        attributes: {
          type: "number",
          step: "any"
        }
      },
      {
        type: "input",
        messageKey: "Lon",
        defaultValue: "-0.1278",
        label: "Longitude",
        attributes: {
          type: "number",
          step: "any"
        }
      },
      {
        type: "text",
        defaultValue:
          "GPS uses the phone first, then these coordinates if it fails. Fixed skips GPS. Default is London."
      }
    ]
  },
  {
    type: "submit",
    defaultValue: "Save"
  }
];
