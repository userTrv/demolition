// Уровни. building — параметры generateFrame, zone — прямоугольник на земле, куда должны лечь обломки,
// neighbors — соседние дома (задевать нельзя), charges — сколько зарядов можно поставить.
import { generateFrame } from './building.js';

export const LEVELS = [
  {
    id: 'garage',
    name: 'Гараж',
    hint: 'Здание держится на колоннах. Подорви колонны первого этажа.',
    building: { bays: [2, 1], bay: 4, floors: 2 },
    zone: { x: [-6.5, 6.5], z: [-4.5, 4.5] },
    neighbors: [],
    charges: 6,
    palette: { wall: '#c98b5e', slab: '#b9b4ab', column: '#8f8a82' },
  },
  {
    id: 'khrushchyovka',
    name: 'Пятиэтажка',
    hint: 'Соседи близко. Сложи дом внутрь себя, не раскидав обломки.',
    building: { bays: [3, 2], bay: 4, floors: 5 },
    zone: { x: [-9, 9], z: [-7, 7] },
    neighbors: [
      { id: 'left', pos: [-17, 7, 0], size: [8, 14, 12], color: '#9fb6c9' },
      { id: 'right', pos: [17, 9, 0], size: [8, 18, 12], color: '#d9c29a' },
    ],
    charges: 12,
    palette: { wall: '#e3dccf', slab: '#b9b4ab', column: '#8f8a82' },
  },
  {
    id: 'tower',
    name: 'Башня',
    hint: 'Места только слева. Уронить башню можно, если убрать опоры с одной стороны.',
    building: { bays: [1, 1], bay: 3, floors: 10 },
    zone: { x: [-30, 2.5], z: [-5, 5] },
    neighbors: [
      { id: 'office', pos: [11, 20, 0], size: [10, 40, 12], color: '#7fa7c2' },
      { id: 'shop', pos: [-2, 3, 13], size: [14, 6, 8], color: '#e0b36a' },
    ],
    charges: 3,
    palette: { wall: '#d98f7a', slab: '#b9b4ab', column: '#8f8a82' },
  },
];

export function buildLevel(level) {
  return { ...level, blocks: generateFrame({ id: level.id, ...level.building }) };
}
