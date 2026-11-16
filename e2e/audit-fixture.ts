export function makeVault() {
  const items: any[] = [];
  const mk = (o: any) =>
    items.push({ id: `id-${items.length + 1}`, type: 1, favorite: false, ...o });
  mk({
    name: "Weak One",
    folderId: "f1",
    login: { username: "w1", password: "123456", uris: [{ uri: "https://weak1.com" }] },
  });
  mk({
    name: "Weak Two",
    favorite: true,
    login: { username: "w2", password: "password", uris: [{ uri: "https://weak2.com" }] },
  });
  mk({
    name: "Reuse A",
    folderId: "f1",
    login: { username: "ra", password: "Zx9!kLm2#qPw8vTy", uris: [{ uri: "https://reuse-a.com" }] },
  });
  mk({
    name: "Reuse B",
    login: { username: "rb", password: "Zx9!kLm2#qPw8vTy", uris: [{ uri: "https://reuse-b.com" }] },
  });
  mk({
    name: "Acme",
    folderId: "f2",
    login: { username: "a1", password: "Qw7#nBv5!tRe3xUo", uris: [{ uri: "https://acme.com" }] },
  });
  mk({
    name: "Acme",
    folderId: "f2",
    favorite: true,
    login: {
      username: "a2",
      password: "Ht6$mCz4&yUi1pLs",
      uris: [{ uri: "https://www.acme.com" }],
    },
  });
  mk({
    name: "Passkey Site",
    login: {
      username: "pk",
      password: "Jk3^dFg8*wSa5nBv",
      uris: [{ uri: "https://pk.com" }],
      fido2Credentials: [
        {
          credentialId: "abc",
          rpId: "pk.com",
          rpName: "pk",
          userHandle: "x",
          counter: "0",
          discoverable: "true",
          creationDate: "2024-01-01T00:00:00Z",
          keyType: "public-key",
          keyAlgorithm: "ECDSA",
          keyCurve: "P-256",
          keyValue: "AAAA",
          userName: "pk",
          userDisplayName: "pk",
        },
      ],
    },
  });
  mk({
    name: "My Phone App",
    login: {
      username: "app",
      password: "Pl5@oKj9#uHb2vCx",
      uris: [{ uri: "androidapp://com.example.app" }],
    },
  });
  mk({ name: "Secret Note", type: 2, notes: "hello", secureNote: { type: 0 } });
  mk({
    name: "Visa",
    type: 3,
    card: {
      cardholderName: "A",
      number: "4111111111111111",
      code: "123",
      expMonth: "1",
      expYear: "2030",
      brand: "Visa",
    },
  });
  mk({ name: "Me", type: 4, identity: { firstName: "A", lastName: "B" } });
  for (let i = 0; i < 25; i++)
    mk({
      name: `Site ${String(i).padStart(2, "0")}`,
      login: {
        username: `user${i}`,
        password: `Gx${i}!kLm2#qPw8vT${i}z`,
        uris: [{ uri: `https://site${i}.example.com` }],
      },
    });
  return {
    encrypted: false,
    folders: [
      { id: "f1", name: "Work" },
      { id: "f2", name: "Shop" },
    ],
    items,
  };
}
