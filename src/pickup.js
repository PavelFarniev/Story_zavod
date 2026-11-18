const latitude = 55.4395;
const longitude = 37.5766;
const coordinates = `${longitude},${latitude}`;
const mapParams = new URLSearchParams({
  ll: coordinates,
  mode: 'whatshere',
  'whatshere[point]': coordinates,
  'whatshere[zoom]': '17',
  z: '17',
});
const routeParams = new URLSearchParams({ rtext: `~${latitude},${longitude}`, rtt: 'auto' });

export const pickup = {
  address: 'Подольск, Домодедовское шоссе, 7',
  map: `https://yandex.ru/map-widget/v1/?${mapParams}`,
  fullMap: `https://yandex.ru/maps/?${mapParams}`,
  route: `https://yandex.ru/maps/?${routeParams}`,
};
