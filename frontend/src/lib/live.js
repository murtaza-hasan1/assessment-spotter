const METERS_PER_MILE = 1609.344

export function milesBetween(first, second) {
  const toRadians = (degrees) => degrees * Math.PI / 180
  const lat1 = toRadians(first.lat)
  const lat2 = toRadians(second.lat)
  const deltaLat = lat2 - lat1
  const deltaLon = toRadians(second.lon - first.lon)
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) / METERS_PER_MILE
}

export function getLiveRouteMetrics(route, location) {
  const points = route?.geometry || []
  if (!location || points.length < 2) return null

  let geometryMiles = 0
  let closestDistance = Infinity
  let progressMiles = 0
  let closestIndex = 0
  for (let index = 0; index < points.length; index += 1) {
    if (index > 0) geometryMiles += milesBetween(points[index - 1], points[index])
    const distance = milesBetween(location, points[index])
    if (distance < closestDistance) {
      closestDistance = distance
      progressMiles = geometryMiles
      closestIndex = index
    }
  }

  const routeMiles = Number(route.distanceMiles) || geometryMiles
  const progressRatio = geometryMiles ? Math.max(0, Math.min(1, progressMiles / geometryMiles)) : 0
  const remainingMiles = Math.max(0, routeMiles * (1 - progressRatio))
  const plannedAverageSpeed = route.durationSeconds > 0 ? routeMiles / (route.durationSeconds / 3600) : 45
  const liveSpeed = Number(location.speedMph)
  const estimatedSpeed = liveSpeed >= 5 && liveSpeed <= 85 ? liveSpeed : plannedAverageSpeed
  const remainingSeconds = remainingMiles / Math.max(estimatedSpeed, 1) * 3600

  return {
    remainingMiles,
    remainingSeconds,
    eta: new Date(Date.now() + remainingSeconds * 1000).toISOString(),
    distanceFromRouteMiles: closestDistance,
    progressRatio,
    closestIndex,
  }
}
