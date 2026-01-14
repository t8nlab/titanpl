export const hello = (req) => {
   return {
        message: `Hello from Titan ${req.body.name}`,
    };
}
