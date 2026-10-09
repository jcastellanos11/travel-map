
interface MapLegendProps {
  countryCount: number;
  tripCount: number;
}

export default function MapLegend({
  countryCount,
  tripCount,
}: MapLegendProps) {
  return (
    <div className="map-legend">
      <div className="map-legend__heading">
        <span className="map-legend__icon">✦</span>
        <span>Explore our memories</span>
      </div>

      <div className="map-legend__stats">
        <div>
          <strong>{countryCount}</strong>
          <span>Countries</span>
        </div>

        <div>
          <strong>{tripCount}</strong>
          <span>Stories</span>
        </div>
      </div>

      <div className="map-legend__items">
        <div>
          <span className="map-legend__dot map-legend__dot--visited" />
          Places with memories
        </div>

        <div>
          <span className="map-legend__dot map-legend__dot--empty" />
          Not explored yet
        </div>
      </div>
    </div>
  );
}
