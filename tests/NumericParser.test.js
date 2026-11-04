const parse = (...args) => require('../src/utils/numeric').parseMetric(...args);
const profile = 'csv-integer-comma';
test.each([['0', 0], ['-0', 0], ['+42', 42], [' 42 ', 42], ['1,234', 1234], ['-1,234,567', -1234567], [25, 25]])('strict parser accepts %s', (input, value) => {
    expect(parse(input, profile)).toEqual({ status: 'valid', value });
});
test.each(['1,50', '12,34,567', '1234,567', '12bad', '1.0', '1e3', '0x10', '(12)', '12-', '1 234', '1\u00a0234', '1"2', true, [12], {}, NaN, Infinity, '9007199254740993', 9007199254740992])('strict parser rejects %s', input => {
    expect(parse(input, profile).status).toBe('invalid');
});
test.each([null, '', ' '])('missing differs from zero: %s', input => {
    expect(parse(input, profile).status).toBe('missing');
});
test('absent column is an invalid schema', () => expect(parse(undefined, profile)).toMatchObject({ status: 'invalid', reason: 'MISSING_FIELD' }));
test('missing profile is ambiguous', () => expect(parse('1,234')).toMatchObject({ status: 'ambiguous' }));
