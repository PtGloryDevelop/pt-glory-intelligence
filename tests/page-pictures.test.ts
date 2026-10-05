import assert from 'node:assert/strict';
import test from 'node:test';
import {graphPictureUrl, pagePicturesFromItems} from '../lib/media/page-pictures.ts';

const pic = 'https://scontent.fbkk1-1.fna.fbcdn.net/v/t39.30808-1/1.jpg';

test('page pictures come only from fbcdn, one per page', () => {
  assert.deepEqual(pagePicturesFromItems([
    {page_id: '123', snapshot: {page_profile_picture_url: pic}},
    {page_id: 456, snapshot: {page_profile_picture_url: pic}},
    {page_id: '789', snapshot: {page_profile_picture_url: 'https://evil.example/x.jpg'}},
    {page_id: 'abc', snapshot: {page_profile_picture_url: pic}},
    {page_id: '999', snapshot: {page_profile_picture_url: 'http://scontent.fbcdn.net/x.jpg'}},
    null,
  ]), [{pageId: '123', url: pic}, {pageId: '456', url: pic}]);
});

test('the default silhouette is not a picture', async () => {
  const reply = (data: object) => (async () => new Response(JSON.stringify({data}))) as unknown as typeof fetch;
  assert.equal(await graphPictureUrl('123', reply({is_silhouette: false, url: pic})), pic);
  assert.equal(await graphPictureUrl('123', reply({is_silhouette: true, url: 'https://static.xx.fbcdn.net/x.gif'})), null);
  assert.equal(await graphPictureUrl('12a', reply({is_silhouette: false, url: pic})), null);
});
