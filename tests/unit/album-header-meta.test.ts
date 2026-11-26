import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {formatAlbumHeaderMeta} from '../../src/library/album-header-meta';

test('album metadata uses accurate counts and plural forms',()=>{
 assert.equal(formatAlbumHeaderMeta(1,1,0,false),'1 canción');
 assert.equal(formatAlbumHeaderMeta(14,1,0,false),'14 canciones');
 assert.equal(formatAlbumHeaderMeta(24,2,0,false),'24 canciones · 2 discos');
 assert.equal(formatAlbumHeaderMeta(14,1,13,true),'14 canciones · 13 descargadas');
 assert.equal(formatAlbumHeaderMeta(1,1,1,false),'1 canción · 1 descargada');
 assert.equal(formatAlbumHeaderMeta(1,1,0,true),'1 canción · 0 descargadas');
});
