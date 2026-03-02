type Req = {
  method?: string;
};

type Res = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => Res;
  json: (body: unknown) => void;
};

export default async function handler(req: Req, res: Res) {
  try {
    if ((req.method || 'GET').toUpperCase() !== 'GET') {
      res.setHeader('Allow', 'GET');
      res.status(405).json({ message: 'Method not allowed' });
      return;
    }

    const upiId = (process.env.UPI_ID || '').trim();
    if (!upiId) {
      res.status(500).json({ message: 'UPI_ID is not configured on the server.' });
      return;
    }

    res.status(200).json({ upiId });
  } catch (_error) {
    res.status(500).json({ message: 'Failed to load payment configuration.' });
  }
}
